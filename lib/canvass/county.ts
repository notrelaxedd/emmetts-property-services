/**
 * Cuyahoga County public parcel layer (ArcGIS REST). Plain Node: global fetch, no next/* or db imports;
 * every network call takes `fetchImpl` so tests run on fixtures.
 *
 * IMPORTANT: the county's field names are NOT known to this code. The GIS host could not be reached while this
 * was written, so nothing below treats a field name as truth. `fetchLayerMeta` reads `/MapServer/<layer>?f=pjson`
 * at runtime, `buildFieldMap` matches the fields it reports against candidate names/aliases, the result is stored
 * in `canvass_settings.parcel_field_map` (owner-editable in Settings) and `parcelFromFeature` reads attributes
 * only through that map. A key whose mapping is null simply yields null.
 */
import { centroidOf, polygonAreaSqft } from "./geometry";
import {
  DERIVED_FIELD_KEYS,
  PARCEL_FIELD_KEYS,
  emptyParcelFieldMap,
  type GeoFeature,
  type ParcelFieldKey,
  type ParcelFieldMap,
  type ParcelFieldMapPatch,
  type ParcelFieldMapping,
  type ParcelGeom,
} from "./types";

export const COUNTY_PARCELS_SERVICE = "https://gis.cuyahogacounty.gov/server/rest/services/Open_Data_Parcels/MapServer";
/** Layer 1 = combined parcels outside Cleveland (Rocky River); layer 0 is Cleveland only. */
export const DEFAULT_PARCEL_LAYER = 1;
export const COUNTY_TIMEOUT_MS = 15_000;
/** Largest page we ask for even when the layer allows more: keeps each response small and the host happy. */
export const MAX_PAGE_SIZE = 1000;
/** Hard stop on pagination so a server that always reports `exceededTransferLimit` cannot loop forever. */
const MAX_PAGES = 100;
export const SQFT_PER_ACRE = 43_560;

/** The county layer URL: `CANVASS_PARCEL_LAYER_URL` wins, else the Open Data service, layer 1. */
export function parcelLayerUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env.CANVASS_PARCEL_LAYER_URL?.trim();
  return (override || `${COUNTY_PARCELS_SERVICE}/${DEFAULT_PARCEL_LAYER}`).replace(/\/+$/, "");
}

// ---------- Layer metadata ----------

export type LayerField = { name: string; type: string; alias: string };
export type LayerMeta = {
  name: string;
  fields: LayerField[];
  maxRecordCount: number;
  supportsPagination: boolean;
  layerUrl: string;
};

type ArcgisError = { error?: { code?: number; message?: string; details?: unknown } };

async function arcgisJson<T>(f: typeof fetch, url: string, init: RequestInit, what: string): Promise<T> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(COUNTY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`county ${what} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // ArcGIS reports most errors as HTTP 200 with an `error` body.
  const json = (await res.json()) as T & ArcgisError;
  if (json && typeof json === "object" && json.error) {
    throw new Error(`county ${what} error ${json.error.code ?? ""}: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

/** `GET <layer>?f=pjson` → the layer's name, fields and paging limits. Field names are whatever the county reports. */
export async function fetchLayerMeta(opts: { fetchImpl?: typeof fetch; layerUrl?: string } = {}): Promise<LayerMeta> {
  const f = opts.fetchImpl ?? fetch;
  const layerUrl = (opts.layerUrl ?? parcelLayerUrl()).replace(/\/+$/, "");
  const json = await arcgisJson<{
    name?: string;
    fields?: Array<{ name?: string; type?: string; alias?: string }>;
    maxRecordCount?: number;
    supportsPagination?: boolean;
    advancedQueryCapabilities?: { supportsPagination?: boolean };
  }>(f, `${layerUrl}?f=pjson`, { headers: { Accept: "application/json" } }, "layer");
  const fields = (json.fields ?? [])
    .filter((fld) => typeof fld.name === "string" && fld.name.length > 0)
    .map((fld) => ({ name: fld.name as string, type: String(fld.type ?? ""), alias: String(fld.alias ?? fld.name) }));
  const max = Number(json.maxRecordCount);
  return {
    name: String(json.name ?? ""),
    fields,
    maxRecordCount: Number.isFinite(max) && max > 0 ? max : MAX_PAGE_SIZE,
    supportsPagination: Boolean(json.advancedQueryCapabilities?.supportsPagination ?? json.supportsPagination ?? true),
    layerUrl,
  };
}

// ---------- Field map ----------

/**
 * Candidate field names per key, most specific first. Matched case-insensitively against the layer's field
 * `name` and `alias`: exact matches win over "contains" matches. `exclude` drops contains-matches that are
 * obviously another key's field (e.g. MAIL_ADDRESS when looking for the site address). This list is a guess
 * at the county's spellings, never a fact: the real names are discovered at runtime from the layer metadata.
 */
export const FIELD_CANDIDATES: Record<ParcelFieldKey, { names: string[]; exclude?: RegExp }> = {
  parcel_id: { names: ["parcelpin", "parcel_pin", "parcel_id", "parcelid", "pin", "parcel_no", "parcelno", "parcel_number", "ppn"] },
  owner: {
    names: ["deeded_owner", "owner_name", "owner", "owner1", "taxpayer", "owner_1", "ownername", "deededowner"],
    exclude: /addr|mail|zip|city|state|occup|phone|type|code/i,
  },
  site_address: {
    names: [
      "site_address",
      "siteaddress",
      "parcel_address",
      "parceladdress",
      "prop_addr",
      "property_address",
      "site_addr",
      "situs_address",
      "situs_addr",
      "full_address",
      "full_addr",
      "address",
      "addr",
    ],
    exclude: /mail|owner|tax|zip|city|state|number|num\b/i,
  },
  site_city: { names: ["site_city", "parcel_city", "prop_city", "property_city", "situs_city", "city"], exclude: /mail|owner|tax/i },
  site_zip: {
    names: ["site_zip", "parcel_zip", "prop_zip", "property_zip", "situs_zip", "zip_code", "zipcode", "zip"],
    exclude: /mail|owner|tax/i,
  },
  mailing_address: {
    names: ["mail_address", "mailing_address", "mailaddress", "mail_addr1", "mail_addr", "tax_mail_addr", "owner_address", "owner_addr", "taxpayer_address"],
  },
  land_use: {
    names: ["land_use", "landuse", "land_use_code", "luc", "tax_luc", "property_class", "prop_class", "class_code", "class", "use_code"],
    exclude: /desc|description/i,
  },
  acreage: { names: ["parcel_acreage", "acreage", "acres", "calc_acres", "calcacres", "gis_acres", "deeded_acres", "total_acres", "land_acres"] },
  shape_area: { names: ["shape_area", "st_area", "shape_starea_", "shape_starea", "starea"] },
  market_value: {
    names: ["total_market_value", "market_value", "mkt_total", "total_value", "appraised_total", "tot_mkt_val", "total_mkt_value", "mkt_val", "market_total"],
    exclude: /land|bldg|building|impr/i,
  },
  year_built: { names: ["year_built", "yr_built", "yearbuilt", "yrbuilt", "built"] },
  living_sqft: { names: ["total_living_area", "living_sqft", "living_area", "sqft_living", "tla", "liv_area", "finished_area"] },
  stories: { names: ["stories", "story_height", "num_stories", "no_stories", "story"] },
  footprint_sqft: { names: ["footprint", "footprint_sqft", "building_sqft", "bldg_sqft", "ground_floor_area", "first_floor_area", "bldg_area"] },
  owner_occupied: {
    names: ["homestead", "owner_occupancy", "own_occ", "owner_occupied", "homestead_credit", "rollback_2_5", "owner_occ", "oo_credit", "homestead_flag"],
  },
  // Optional: when the layer has no street-name field the street is derived from the site address (`streetOf`).
  street: {
    names: ["site_street", "parcel_street", "prop_street", "situs_street", "street_name", "streetname", "st_name", "road_name", "street"],
    exclude: /mail|owner|tax|num|number|no$|type|suffix|dir|pre|post|light/i,
  },
};

/** "Parcel Address" / "PARCEL_ADDRESS" / "Shape.STArea()" → "parcel_address" / "parcel_address" / "shape_starea_". */
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");

/** Every layer field that looks like a candidate for the key: exact name/alias matches first, then contains. */
export function candidateFields(key: ParcelFieldKey, fields: LayerField[]): string[] {
  const { names, exclude } = FIELD_CANDIDATES[key];
  const exact: string[] = [];
  const contains: string[] = [];
  for (const cand of names) {
    for (const fld of fields) {
      const n = norm(fld.name);
      const a = norm(fld.alias);
      if (n === cand || a === cand) {
        if (!exact.includes(fld.name)) exact.push(fld.name);
      } else if ((n.includes(cand) || a.includes(cand)) && !(exclude && (exclude.test(fld.name) || exclude.test(fld.alias)))) {
        if (!contains.includes(fld.name)) contains.push(fld.name);
      }
    }
  }
  return [...exact, ...contains.filter((c) => !exact.includes(c))];
}

/** Manual picks to keep when rebuilding the map (anything the owner chose in Settings). */
export type FieldOverrides = Partial<Record<ParcelFieldKey, string | null>>;

/** The owner's manual picks from a stored map, in the shape `buildFieldMap` takes back. */
export function manualOverrides(map: ParcelFieldMapPatch | null | undefined): FieldOverrides {
  const out: FieldOverrides = {};
  if (!map) return out;
  for (const key of PARCEL_FIELD_KEYS) {
    const m = map[key];
    if (m && m.source === "manual") out[key] = m.field;
  }
  return out;
}

/**
 * Layer fields → field map. Each key gets the first exact match (else first contains match), every candidate found,
 * and the full field list so Settings can offer any field. `overrides` (owner picks) win; an override of null means
 * "the owner says this layer has no such field".
 */
export function buildFieldMap(
  fields: LayerField[],
  overrides: FieldOverrides = {},
  meta: { layerName?: string; fetchedAt?: string } = {},
): ParcelFieldMap {
  const map: ParcelFieldMap = emptyParcelFieldMap();
  map.layer_fields = fields.map((f) => ({ name: f.name, type: f.type, alias: f.alias }));
  map.layer_name = meta.layerName ?? "";
  map.fetched_at = meta.fetchedAt ?? new Date().toISOString();
  for (const key of PARCEL_FIELD_KEYS) {
    const candidates = candidateFields(key, fields);
    let mapping: ParcelFieldMapping;
    if (key in overrides) {
      const chosen = overrides[key] ?? null;
      const real = chosen === null ? null : (fields.find((f) => norm(f.name) === norm(chosen))?.name ?? chosen);
      mapping = { field: real, source: "manual", candidates };
    } else {
      mapping = { field: candidates[0] ?? null, source: candidates.length > 0 ? "auto" : "missing", candidates };
    }
    map[key] = mapping;
  }
  return map;
}

/** Keys the map could not resolve (for the pull warnings / Settings banner). Derived keys (`street`) are not reported. */
export function missingFieldKeys(map: ParcelFieldMapPatch): ParcelFieldKey[] {
  return PARCEL_FIELD_KEYS.filter((k) => !DERIVED_FIELD_KEYS.includes(k) && !map[k]?.field);
}

// ---------- Query ----------

export type ParcelQueryOpts = {
  /** GeoJSON Polygon in WGS84 drawn by the owner. */
  polygon: { type: "Polygon"; coordinates: [number, number][][] };
  fetchImpl?: typeof fetch;
  layerUrl?: string;
  /** From `fetchLayerMeta`; the page size is min(maxRecordCount, 1000). */
  maxRecordCount?: number;
  onPage?: (info: { page: number; received: number; total: number }) => void;
};

/** Esri JSON polygon for a GeoJSON polygon (rings, WGS84). */
export function esriPolygon(polygon: ParcelQueryOpts["polygon"]) {
  return { rings: polygon.coordinates, spatialReference: { wkid: 4326 } };
}

/** The form body for one page of `<layer>/query`. Sent as POST because a drawn polygon can be long for a URL. */
export function parcelQueryParams(polygon: ParcelQueryOpts["polygon"], offset: number, count: number): URLSearchParams {
  const p = new URLSearchParams();
  p.set("f", "geojson");
  p.set("geometry", JSON.stringify(esriPolygon(polygon)));
  p.set("geometryType", "esriGeometryPolygon");
  p.set("inSR", "4326");
  p.set("outSR", "4326");
  p.set("spatialRel", "esriSpatialRelIntersects");
  p.set("outFields", "*");
  p.set("returnGeometry", "true");
  p.set("resultOffset", String(offset));
  p.set("resultRecordCount", String(count));
  return p;
}

type GeojsonPage = {
  type?: string;
  features?: GeoFeature<ParcelGeom | null>[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
};

/**
 * Every parcel feature intersecting the polygon, as GeoJSON (WGS84). Pages are fetched one after another
 * (resultOffset / resultRecordCount) until a page comes back short or the server says the transfer limit was
 * not exceeded; sequential on purpose so the county host sees one request at a time.
 */
export async function queryParcels(opts: ParcelQueryOpts): Promise<GeoFeature<ParcelGeom | null>[]> {
  const f = opts.fetchImpl ?? fetch;
  const layerUrl = (opts.layerUrl ?? parcelLayerUrl()).replace(/\/+$/, "");
  const pageSize = Math.max(1, Math.min(opts.maxRecordCount ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE));
  const out: GeoFeature<ParcelGeom | null>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = parcelQueryParams(opts.polygon, page * pageSize, pageSize);
    const json = await arcgisJson<GeojsonPage>(
      f,
      `${layerUrl}/query`,
      { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body },
      "query",
    );
    const features = Array.isArray(json.features) ? json.features : [];
    out.push(...features);
    opts.onPage?.({ page: page + 1, received: features.length, total: out.length });
    const exceeded = json.exceededTransferLimit ?? json.properties?.exceededTransferLimit;
    if (features.length < pageSize || exceeded === false) break;
  }
  return out;
}

// ---------- Feature → parcels row ----------

/**
 * The `parcels` row as the county fills it (minus id/timestamps and the columns our own data owns:
 * block_group_geoid, turf_*, callback_window, home_pattern, do_not_knock*, customer_id). Column names match the
 * canvass migration exactly; `raw` keeps every attribute as fetched so a remapped field can be re-read later.
 */
export type ParcelInput = {
  parcel_id: string;
  address: string;
  street: string;
  city: string | null;
  zip: string | null;
  owner_display: string | null;
  mailing_address: string | null;
  land_use: string | null;
  lot_sqft: number | null;
  living_sqft: number | null;
  stories: number | null;
  footprint_sqft: number | null;
  year_built: number | null;
  market_value: number | null;
  owner_occupied: boolean | null;
  owner_is_entity: boolean;
  geom: ParcelGeom | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  raw: Record<string, unknown>;
};

/** LLC / trust / corporate owners get the landlord pitch. */
export const ENTITY_OWNER_RE =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|TRUST|TRUSTEE|TRUSTEES|TR|LTD|LP|LLP|PROPERTIES|HOLDINGS|REALTY|INVESTMENTS|BANK|CHURCH|CITY OF|HOUSING|ASSOCIATION|ASSN|PARTNERS|PARTNERSHIP|ENTERPRISES|RENTALS)\b/i;

/** Upper-case, punctuation stripped, spaces collapsed. Expands nothing ("ST" stays "ST", "STREET" stays "STREET"). */
export function normalizeAddress(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "19000 Detroit Rd Unit 4" → "DETROIT RD": the house number (and fraction / range / unit) stripped, upper-cased. */
export function streetOf(address: string | null | undefined): string {
  // "#4" / "# 4" units go first: normalizeAddress drops the "#".
  let s = normalizeAddress((address ?? "").replace(/#\s*[A-Za-z0-9-]+\s*$/, ""));
  // Leading house number: "19000", "19000A", "19000 1 2" (was 1/2), "19000 19002" (was 19000-19002). The street
  // starts with a letter or an ordinal ("1234 10TH ST").
  s = s.replace(/^\d+[A-Z]?(\s+\d+(\s+\d+)?)?\s+(?=[A-Z]|\d+(ST|ND|RD|TH)\b)/, "");
  // Trailing unit: "UNIT 4", "APT B", "STE 200". A bare trailing number is left alone (ambiguous).
  s = s.replace(/\s+(UNIT|APT|APARTMENT|STE|SUITE|BLDG|LOT|FL|FLOOR|REAR|UPPER|LOWER|UP|DN|DOWN)\s*[A-Z0-9]*$/, "");
  return s.trim();
}

/** True when the land-use / class code starts with one of the residential prefixes (county codes are strings). */
export function isResidential(landUse: string | number | null | undefined, prefixes: readonly string[]): boolean {
  if (landUse === null || landUse === undefined) return false;
  const code = String(landUse).trim();
  if (!code) return false;
  return prefixes.some((p) => p.length > 0 && code.startsWith(p.trim()));
}

const present = (v: unknown) => v !== null && v !== undefined && v !== "";

/** Read one key through the map: null mapping → null. Property keys are matched exactly, then case-insensitively. */
export function readMapped(props: Record<string, unknown> | null | undefined, map: ParcelFieldMapPatch, key: ParcelFieldKey): unknown {
  const field = map[key]?.field;
  if (!field || !props) return null;
  if (field in props) return present(props[field]) ? props[field] : null;
  const want = field.toLowerCase();
  for (const k of Object.keys(props)) {
    if (k.toLowerCase() === want) return present(props[k]) ? props[k] : null;
  }
  return null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s : null;
};

const TRUE_WORDS = new Set(["Y", "YES", "TRUE", "T", "X", "1"]);
const FALSE_WORDS = new Set(["N", "NO", "FALSE", "F", "0", "NONE", "NA", "N/A", "NULL"]);

/**
 * A homestead / owner-occupancy style value → boolean. Y/YES/TRUE/1 → true, N/NO/0/NONE → false, a positive number
 * (a credit amount) → true, any other non-empty text (e.g. "2.5% ROLLBACK") → true, nothing → null.
 */
export function ownerOccupiedFlag(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  const n = num(s);
  if (n !== null) return n > 0;
  return true;
}

/** Mailing address vs site address: same street line → owner-occupied; null when either is missing. */
export function mailingMatchesSite(site: string | null, mailing: string | null): boolean | null {
  const s = normalizeAddress(site);
  const m = normalizeAddress(mailing);
  if (!s || !m) return null;
  return m === s || m.startsWith(`${s} `) || s.startsWith(`${m} `);
}

export type ParcelFromFeatureOpts = {
  /** Treat the geometry as missing (e.g. the layer returned no geometry). */
  ignoreGeometry?: boolean;
};

/**
 * One GeoJSON feature from the county layer → a `parcels` row input, reading attributes only through the field map.
 * Returns null when the feature carries no parcel id (nothing to upsert on). Lot size: acreage × 43,560, else the
 * geodesic area of the polygon. Owner-occupied: the homestead-style field when mapped, else mailing vs site address,
 * else null (unknown). Street: the mapped street field when the layer has one, else derived from the site address.
 */
export function parcelFromFeature(
  feature: GeoFeature<ParcelGeom | null>,
  map: ParcelFieldMapPatch,
  opts: ParcelFromFeatureOpts = {},
): ParcelInput | null {
  const props = feature.properties ?? {};
  const parcelId = text(readMapped(props, map, "parcel_id"));
  if (!parcelId) return null;

  const geomRaw = opts.ignoreGeometry ? null : feature.geometry;
  const geom = geomRaw && (geomRaw.type === "Polygon" || geomRaw.type === "MultiPolygon") ? geomRaw : null;
  const centroid = centroidOf(geom);

  const address = text(readMapped(props, map, "site_address")) ?? "";
  // A mapped street-name field wins (normalised like the address); otherwise the street is derived from the address.
  const mappedStreet = normalizeAddress(text(readMapped(props, map, "street")));
  const mailing = text(readMapped(props, map, "mailing_address"));
  const owner = text(readMapped(props, map, "owner"));
  const acreage = positive(readMapped(props, map, "acreage"));
  const polygonSqft = geom ? polygonAreaSqft(geom) : 0;
  const lotSqft = acreage !== null ? acreage * SQFT_PER_ACRE : polygonSqft > 0 ? polygonSqft : null;
  const stories = positive(readMapped(props, map, "stories"));
  const yearBuilt = positive(readMapped(props, map, "year_built"));

  const homestead = map.owner_occupied?.field ? ownerOccupiedFlag(readMapped(props, map, "owner_occupied")) : null;
  const ownerOccupied = homestead !== null ? homestead : mailingMatchesSite(address, mailing);

  const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  return {
    parcel_id: parcelId,
    address,
    street: mappedStreet || streetOf(address),
    city: text(readMapped(props, map, "site_city")),
    zip: text(readMapped(props, map, "site_zip")),
    owner_display: owner,
    mailing_address: mailing,
    land_use: text(readMapped(props, map, "land_use")),
    lot_sqft: round1(lotSqft),
    living_sqft: round1(positive(readMapped(props, map, "living_sqft"))),
    stories,
    footprint_sqft: round1(positive(readMapped(props, map, "footprint_sqft"))),
    year_built: yearBuilt === null ? null : Math.round(yearBuilt),
    market_value: positive(readMapped(props, map, "market_value")),
    owner_occupied: ownerOccupied,
    owner_is_entity: owner !== null && ENTITY_OWNER_RE.test(owner),
    geom,
    centroid_lat: centroid ? centroid[1] : null,
    centroid_lng: centroid ? centroid[0] : null,
    raw: { ...props },
  };
}
