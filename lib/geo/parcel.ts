/**
 * Parcel / lot-size lookup. PARCEL_SOURCE env: none (default) | cuyahoga_gis | regrid (stub).
 * "none" returns null, meaning the owner enters lot size by hand.
 * Plain Node: no next/* imports.
 */

export type ParcelResult = { parcel_id: string | null; lot_acres: number | null; source: string };
export type ParcelQuery = { lat: number; lng: number; address?: string };

export async function lookupParcel(q: ParcelQuery, opts: { fetchImpl?: typeof fetch } = {}): Promise<ParcelResult | null> {
  const source = process.env.PARCEL_SOURCE ?? "none";
  switch (source) {
    case "none":
      return null;
    case "cuyahoga_gis":
      return lookupCuyahogaGis(q, opts);
    case "regrid":
      return lookupRegrid(q, opts);
    default:
      throw new Error(`Unknown PARCEL_SOURCE "${source}" (expected none | cuyahoga_gis | regrid)`);
  }
}

// Cuyahoga County GIS parcels: an ArcGIS REST point-in-polygon query against the county's tax-parcel layer.
// PARCEL_GIS_URL is the layer URL (".../FeatureServer/0" or ".../MapServer/0"); it is configured, not hard-coded,
// because the county moves services between hosts. Field names are auto-detected from the attributes
// (PARCEL_GIS_ID_FIELD / PARCEL_GIS_ACRES_FIELD / PARCEL_GIS_SQFT_FIELD override). Square feet / 43,560 = acres.
// Cuyahoga: gis.cuyahogacounty.gov/server/rest/services/CCFO/Parcel_Fabric_Taxparcels/FeatureServer/0
// (EPSG 102722, PIN in `parcel_id`, size in `parcel_acreage`; `Shape__Area` is in state-plane feet, unused).
const ID_FIELDS = ["parcelpin", "parcel_pin", "parcel_id", "parcelid", "pin", "parcelnumb", "parcel_number"];
const ACRE_FIELDS = ["parcel_acreage", "calc_acres", "calcacres", "gis_acres", "acres", "acreage", "total_acres", "totalacres", "deeded_acres", "deededacres", "land_acres", "ll_gisacre"];
const SQFT_FIELDS = ["calc_sqft", "land_sqft", "landsqft", "sqft", "sq_ft", "square_feet", "area_sqft", "lot_sqft", "total_sqft"];
const SQFT_PER_ACRE = 43_560;
/** Fallback search radius when the point misses every parcel (a geocoded point on the street side). */
const NEAR_METERS = 20;
const GIS_TIMEOUT_MS = 15_000;

type Attrs = Record<string, unknown>;

const present = (v: unknown) => v !== null && v !== undefined && v !== "";

/** Case-insensitive attribute lookup: the explicit field if set, else the first candidate whose value is accepted. */
export function pickField(attrs: Attrs, explicit: string | undefined, candidates: string[], accept = present): unknown {
  const byLower = new Map(Object.keys(attrs).map((k) => [k.toLowerCase(), k]));
  for (const name of explicit ? [explicit] : candidates) {
    const key = byLower.get(name.toLowerCase());
    if (key !== undefined && accept(attrs[key])) return attrs[key];
  }
  return undefined;
}

const positive = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One parcel's attributes → parcel id + acres (null when the layer has no usable size). */
export function parcelFromAttributes(attrs: Attrs, env: Record<string, string | undefined> = process.env): ParcelResult {
  const id = pickField(attrs, env.PARCEL_GIS_ID_FIELD, ID_FIELDS);
  // A zero / blank size means "not recorded", so auto-detection moves on to the next candidate.
  const isSize = (v: unknown) => positive(v) !== null;
  let acres = positive(pickField(attrs, env.PARCEL_GIS_ACRES_FIELD, env.PARCEL_GIS_SQFT_FIELD ? [] : ACRE_FIELDS, isSize));
  if (acres === null && !env.PARCEL_GIS_ACRES_FIELD) {
    const sqft = positive(pickField(attrs, env.PARCEL_GIS_SQFT_FIELD, SQFT_FIELDS, isSize));
    if (sqft !== null) acres = sqft / SQFT_PER_ACRE;
  }
  // A residential lot over 1,000 acres is a bad field mapping, not a customer: leave it for the owner.
  if (acres !== null && acres >= 1000) acres = null;
  return {
    parcel_id: id === undefined ? null : String(id).trim() || null,
    lot_acres: acres === null ? null : Math.round(acres * 1000) / 1000,
    source: "cuyahoga_gis",
  };
}

export function arcgisQueryUrl(layerUrl: string, q: ParcelQuery, nearMeters = 0): string {
  const u = new URL(`${layerUrl.replace(/\/+$/, "")}/query`);
  u.searchParams.set("f", "json");
  u.searchParams.set("geometry", `${q.lng},${q.lat}`);
  u.searchParams.set("geometryType", "esriGeometryPoint");
  u.searchParams.set("inSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  u.searchParams.set("outFields", "*");
  u.searchParams.set("returnGeometry", "false");
  if (nearMeters > 0) {
    u.searchParams.set("distance", String(nearMeters));
    u.searchParams.set("units", "esriSRUnit_Meter");
  }
  return u.toString();
}

async function queryLayer(f: typeof fetch, url: string): Promise<Attrs[]> {
  const res = await f(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(GIS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`parcel GIS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // ArcGIS reports most errors as HTTP 200 with an `error` body.
  const json = (await res.json()) as { error?: { code?: number; message?: string }; features?: Array<{ attributes?: Attrs }> };
  if (json.error) throw new Error(`parcel GIS error ${json.error.code ?? ""}: ${json.error.message ?? "unknown"}`);
  return (json.features ?? []).map((ft) => ft.attributes ?? {});
}

async function lookupCuyahogaGis(q: ParcelQuery, opts: { fetchImpl?: typeof fetch }): Promise<ParcelResult | null> {
  const layerUrl = process.env.PARCEL_GIS_URL?.trim();
  if (!layerUrl) throw new Error("PARCEL_GIS_URL is required when PARCEL_SOURCE=cuyahoga_gis");
  const f = opts.fetchImpl ?? fetch;
  let hits = await queryLayer(f, arcgisQueryUrl(layerUrl, q));
  // Street-interpolated geocodes can land just outside the lot. Accept a nearby parcel only when it is unambiguous.
  if (hits.length === 0) {
    const near = await queryLayer(f, arcgisQueryUrl(layerUrl, q, NEAR_METERS));
    hits = near.length === 1 ? near : [];
  }
  return hits.length > 0 ? parcelFromAttributes(hits[0]) : null;
}

// TODO [PARCEL DATA SOURCE — ask owner]: Regrid (paid API). STUB, returns null.
// Likely shape: GET https://app.regrid.com/api/v2/parcels/point?lat=<lat>&lon=<lng>&token=<REGRID_API_TOKEN>
// Response: { parcels: { features: [{ properties: { fields: { parcelnumb, ll_gisacre } } }] } }
// Needs a paid token and owner sign-off before use.
async function lookupRegrid(_q: ParcelQuery, _opts: { fetchImpl?: typeof fetch }): Promise<ParcelResult | null> {
  return null;
}
