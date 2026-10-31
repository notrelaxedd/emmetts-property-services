/**
 * Fill a parcel's missing city and ZIP from where its centroid sits: Census TIGERweb "Incorporated Places" (NAME →
 * city) and "ZIP Code Tabulation Areas" (ZCTA5 → zip), point-in-polygon locally. The county's own site city / zip
 * columns win; this only fills blanks, and the answer is cached on the parcel row (a filled parcel is never queried
 * again). Same host as the block-group lookup (tigerweb.geo.census.gov, already allowed); no other reverse geocoder.
 * Layer ids are discovered by name at runtime (lib/canvass/tiger.ts), and every call takes `fetchImpl` for tests.
 */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { Parcel } from "../db/types";
import { check } from "../ops/types";
import type { Db } from "../ops/types";
import type { Bbox } from "./geometry";
import { TIGERWEB_SERVICE, findLayerIdByName, getJson } from "./tiger";
import type { GeoFeature, ParcelGeom, Position } from "./types";

export const PLACE_LAYER_NAME = "Incorporated Places";
export const ZCTA_LAYER_NAME = "ZIP Code Tabulation Areas";

/** Parcels per `.in()` filter. */
const CHUNK = 100;
/** Points are grouped into grid cells this many degrees on a side (~5.5 km) so one envelope query serves a street or a neighbourhood. */
const CELL_DEG = 0.05;

type Row = Pick<Parcel, "id" | "city" | "zip" | "centroid_lat" | "centroid_lng">;
type Region = { value: string; geom: ParcelGeom };

export type CityZipFill = {
  /** Parcels that were missing a city or a zip and have a location. */
  checked: number;
  cityFilled: number;
  zipFilled: number;
  /** What was written, by parcels.id (only the columns that were filled). */
  filled: Map<string, { city?: string; zip?: string }>;
};

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";

function envelopeQueryUrl(serviceUrl: string, layerId: number, bbox: Bbox): string {
  const u = new URL(`${serviceUrl.replace(/\/+$/, "")}/${layerId}/query`);
  u.searchParams.set("f", "geojson");
  u.searchParams.set("geometry", bbox.join(","));
  u.searchParams.set("geometryType", "esriGeometryEnvelope");
  u.searchParams.set("inSR", "4326");
  u.searchParams.set("outSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  // Field names differ between TIGERweb layers and vintages; ask for all of them and read the right one below.
  u.searchParams.set("outFields", "*");
  u.searchParams.set("returnGeometry", "true");
  return u.toString();
}

const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

/** The regions (place name or ZCTA5) intersecting the envelope, with their polygons. */
async function fetchRegions(
  kind: "place" | "zip",
  bbox: Bbox,
  opts: { fetchImpl?: typeof fetch; serviceUrl: string; layerId: number },
): Promise<Region[]> {
  const f = opts.fetchImpl ?? fetch;
  const json = await getJson<{ features?: GeoFeature<ParcelGeom | null>[] }>(f, envelopeQueryUrl(opts.serviceUrl, opts.layerId, bbox), `tigerweb ${kind} query`);
  const out: Region[] = [];
  for (const feat of json.features ?? []) {
    const geom = feat.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const props = feat.properties ?? {};
    const value = kind === "place" ? (str(props.NAME) ?? str(props.BASENAME)) : (str(props.ZCTA5) ?? str(props.BASENAME) ?? str(props.GEOID));
    if (value) out.push({ value, geom });
  }
  return out;
}

function regionAt(regions: readonly Region[], at: Position): string | null {
  for (const r of regions) {
    try {
      if (booleanPointInPolygon(turfPoint(at), r.geom)) return r.value;
    } catch {
      // A malformed polygon never matches.
    }
  }
  return null;
}

const cellKey = (r: Row) => `${Math.floor((r.centroid_lat as number) / CELL_DEG)}:${Math.floor((r.centroid_lng as number) / CELL_DEG)}`;

/**
 * For the given parcels (by `parcels.id`) with a null / blank city or zip: one TIGERweb envelope query per grid cell
 * and layer, point-in-polygon on each centroid, and the filled columns written back. A zip that is already set is
 * never replaced, nor is a city. A layer that fails (or has no such layer) leaves that column blank and adds a
 * warning; the other column and the other cells still fill. A centroid outside every polygon (unincorporated land)
 * keeps a null city.
 */
export async function fillMissingCityZip(
  db: Db,
  parcelIds: readonly string[],
  opts: { fetchImpl?: typeof fetch; serviceUrl?: string; warnings?: string[]; log?: (msg: string) => void } = {},
): Promise<CityZipFill> {
  const result: CityZipFill = { checked: 0, cityFilled: 0, zipFilled: 0, filled: new Map() };
  const serviceUrl = (opts.serviceUrl ?? TIGERWEB_SERVICE).replace(/\/+$/, "");
  const warn = (msg: string) => opts.warnings?.push(msg);

  const unique = Array.from(new Set(parcelIds));
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    rows.push(...(check(await db.from("parcels").select("id,city,zip,centroid_lat,centroid_lng").in("id", chunk), "reverse parcels") ?? []));
  }
  const todo = rows.filter(
    (r) => (blank(r.city) || blank(r.zip)) && r.centroid_lat !== null && r.centroid_lng !== null && Number.isFinite(r.centroid_lat) && Number.isFinite(r.centroid_lng),
  );
  result.checked = todo.length;
  if (todo.length === 0) return result;

  const layerIds: { place?: number; zip?: number } = {};
  const layerFailed = { place: false, zip: false };
  const layerId = async (kind: "place" | "zip"): Promise<number | null> => {
    if (layerFailed[kind]) return null;
    if (layerIds[kind] !== undefined) return layerIds[kind] as number;
    try {
      const id =
        kind === "place"
          ? await findLayerIdByName(PLACE_LAYER_NAME, { fetchImpl: opts.fetchImpl, serviceUrl, fallbacks: ["incorporated places"] })
          : await findLayerIdByName(ZCTA_LAYER_NAME, { fetchImpl: opts.fetchImpl, serviceUrl, fallbacks: ["zip code tabulation"] });
      layerIds[kind] = id;
      return id;
    } catch (e) {
      layerFailed[kind] = true;
      warn(`City/ZIP lookup (${kind === "place" ? "places" : "ZIP areas"}) unavailable: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const cells = new Map<string, Row[]>();
  for (const r of todo) {
    const key = cellKey(r);
    const list = cells.get(key) ?? [];
    list.push(r);
    cells.set(key, list);
  }

  const cellList = Array.from(cells.values());
  for (const group of cellList) {
    const lats = group.map((r) => r.centroid_lat as number);
    const lngs = group.map((r) => r.centroid_lng as number);
    // A little padding keeps a point on the very edge of the envelope inside it.
    const pad = 0.0005;
    const bbox: Bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
    const needCity = group.some((r) => blank(r.city));
    const needZip = group.some((r) => blank(r.zip));
    const regions: { place: Region[]; zip: Region[] } = { place: [], zip: [] };
    for (const kind of ["place", "zip"] as const) {
      if ((kind === "place" ? !needCity : !needZip)) continue;
      const id = await layerId(kind);
      if (id === null) continue;
      try {
        regions[kind] = await fetchRegions(kind, bbox, { fetchImpl: opts.fetchImpl, serviceUrl, layerId: id });
      } catch (e) {
        warn(`City/ZIP lookup (${kind === "place" ? "places" : "ZIP areas"}) failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const r of group) {
      const at: Position = [r.centroid_lng as number, r.centroid_lat as number];
      const patch: { city?: string; zip?: string } = {};
      if (blank(r.city)) {
        const city = regionAt(regions.place, at);
        if (city) patch.city = city;
      }
      if (blank(r.zip)) {
        const zip = regionAt(regions.zip, at);
        if (zip) patch.zip = zip.slice(0, 5);
      }
      if (!patch.city && !patch.zip) continue;
      check(await db.from("parcels").update(patch).eq("id", r.id), "reverse update parcel");
      result.filled.set(r.id, patch);
      if (patch.city) result.cityFilled++;
      if (patch.zip) result.zipFilled++;
    }
  }
  opts.log?.(`[canvass] city/zip: ${result.cityFilled} city, ${result.zipFilled} zip filled for ${result.checked} parcel(s)`);
  return result;
}
