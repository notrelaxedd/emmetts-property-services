/**
 * Block-group assignment for parcel centroids. Plain Node: global fetch, no next/* or db imports; every network
 * call takes `fetchImpl` so tests run on fixtures.
 *
 * Primary: Census TIGERweb (ArcGIS REST) block-group polygons for the pulled area's bounding box, then
 * point-in-polygon locally (one request for a whole street). Fallback: the Census geocoder's coordinates lookup,
 * one point per request, at most two in flight. Both hosts belong to the Census Bureau; only a GEOID comes back.
 */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import { centroidOf, distanceMeters, type Bbox } from "./geometry";
import type { GeoFeature, ParcelGeom, Position } from "./types";

export const TIGERWEB_SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
export const BLOCK_GROUP_LAYER_NAME = "Census Block Groups";
export const CENSUS_GEOCODER_COORDINATES = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
export const TIGER_TIMEOUT_MS = 15_000;
export const GEOCODER_CONCURRENCY = 2;

type ArcgisError = { error?: { code?: number; message?: string } };

export async function getJson<T>(f: typeof fetch, url: string, what: string): Promise<T> {
  const res = await f(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIGER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as T & ArcgisError;
  // ArcGIS reports most errors as HTTP 200 with an `error` body.
  if (json && typeof json === "object" && json.error) throw new Error(`${what} error ${json.error.code ?? ""}: ${json.error.message ?? "unknown"}`);
  return json;
}

// ---------- Layer discovery ----------

const layerIdCache = new Map<string, number>();

/** Test hook. */
export function _resetTigerCache() {
  layerIdCache.clear();
}

/** The id of the "Census Block Groups" layer from the service's `?f=pjson` layer list (cached per service URL). */
export async function findBlockGroupLayerId(opts: { fetchImpl?: typeof fetch; serviceUrl?: string } = {}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const serviceUrl = (opts.serviceUrl ?? TIGERWEB_SERVICE).replace(/\/+$/, "");
  const cached = layerIdCache.get(serviceUrl);
  if (cached !== undefined) return cached;
  const json = await getJson<{ layers?: Array<{ id?: number; name?: string }> }>(f, `${serviceUrl}?f=pjson`, "tigerweb service");
  const want = BLOCK_GROUP_LAYER_NAME.toLowerCase();
  const layers = json.layers ?? [];
  const hit =
    layers.find((l) => (l.name ?? "").trim().toLowerCase() === want) ??
    layers.find((l) => (l.name ?? "").toLowerCase().includes("block group"));
  if (!hit || typeof hit.id !== "number") throw new Error(`tigerweb: no "${BLOCK_GROUP_LAYER_NAME}" layer in ${serviceUrl}`);
  layerIdCache.set(serviceUrl, hit.id);
  return hit.id;
}

/**
 * The id of any layer by its name (exact, case-insensitive; else the first whose name contains one of `fallbacks`),
 * cached per service URL + name. Used for "Incorporated Places" and "ZIP Code Tabulation Areas" (lib/canvass/reverse.ts).
 */
export async function findLayerIdByName(
  name: string,
  opts: { fetchImpl?: typeof fetch; serviceUrl?: string; fallbacks?: string[] } = {},
): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const serviceUrl = (opts.serviceUrl ?? TIGERWEB_SERVICE).replace(/\/+$/, "");
  const cacheKey = `${serviceUrl}#${name.toLowerCase()}`;
  const cached = layerIdCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const json = await getJson<{ layers?: Array<{ id?: number; name?: string }> }>(f, `${serviceUrl}?f=pjson`, "tigerweb service");
  const layers = json.layers ?? [];
  const want = name.trim().toLowerCase();
  const hit =
    layers.find((l) => (l.name ?? "").trim().toLowerCase() === want) ??
    layers.find((l) => (opts.fallbacks ?? []).some((fb) => (l.name ?? "").toLowerCase().includes(fb.toLowerCase())));
  if (!hit || typeof hit.id !== "number") throw new Error(`tigerweb: no "${name}" layer in ${serviceUrl}`);
  layerIdCache.set(cacheKey, hit.id);
  return hit.id;
}

// ---------- Polygons by envelope ----------

export type BlockGroupPolygon = {
  /** 12-digit GEOID (state + county + tract + block group). */
  geoid: string;
  geom: ParcelGeom;
  properties: Record<string, unknown>;
};

export function blockGroupQueryUrl(serviceUrl: string, layerId: number, bbox: Bbox): string {
  const u = new URL(`${serviceUrl.replace(/\/+$/, "")}/${layerId}/query`);
  u.searchParams.set("f", "geojson");
  u.searchParams.set("geometry", bbox.join(","));
  u.searchParams.set("geometryType", "esriGeometryEnvelope");
  u.searchParams.set("inSR", "4326");
  u.searchParams.set("outSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  u.searchParams.set("outFields", "GEOID,STATE,COUNTY,TRACT,BLKGRP");
  u.searchParams.set("returnGeometry", "true");
  return u.toString();
}

const geoidOf = (props: Record<string, unknown> | null): string | null => {
  if (!props) return null;
  const direct = props.GEOID ?? props.geoid;
  if (direct !== undefined && direct !== null && /^\d{12}$/.test(String(direct))) return String(direct);
  const parts = [props.STATE, props.COUNTY, props.TRACT, props.BLKGRP].map((v) => (v === undefined || v === null ? "" : String(v)));
  const joined = parts.join("");
  return /^\d{12}$/.test(joined) ? joined : null;
};

/** Block-group polygons intersecting the bbox (WGS84), with their GEOIDs. Empty when TIGERweb returns nothing. */
export async function fetchBlockGroupPolygons(
  bbox: Bbox,
  opts: { fetchImpl?: typeof fetch; serviceUrl?: string; layerId?: number } = {},
): Promise<BlockGroupPolygon[]> {
  const f = opts.fetchImpl ?? fetch;
  const serviceUrl = (opts.serviceUrl ?? TIGERWEB_SERVICE).replace(/\/+$/, "");
  const layerId = opts.layerId ?? (await findBlockGroupLayerId({ fetchImpl: f, serviceUrl }));
  const json = await getJson<{ features?: GeoFeature<ParcelGeom | null>[] }>(f, blockGroupQueryUrl(serviceUrl, layerId, bbox), "tigerweb query");
  const out: BlockGroupPolygon[] = [];
  for (const feat of json.features ?? []) {
    const geom = feat.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const geoid = geoidOf(feat.properties);
    if (!geoid) continue;
    out.push({ geoid, geom, properties: feat.properties ?? {} });
  }
  return out;
}

// ---------- Assignment ----------

export type PointToAssign = { id: string; lng: number; lat: number };

/**
 * Each point → the GEOID of the polygon containing it; a point in no polygon gets the polygon with the nearest
 * centroid (the bbox query always returns the neighbours, so this is a boundary-precision fallback). Points with
 * non-finite coordinates are skipped; with no polygons at all the map is empty.
 */
export function assignBlockGroups(points: PointToAssign[], polygons: BlockGroupPolygon[]): Map<string, string> {
  const out = new Map<string, string>();
  if (polygons.length === 0) return out;
  const centroids = polygons.map((p) => ({ geoid: p.geoid, centroid: centroidOf(p.geom) }));
  for (const pt of points) {
    if (!Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) continue;
    const here: Position = [pt.lng, pt.lat];
    let hit: string | null = null;
    for (const poly of polygons) {
      let inside = false;
      try {
        inside = booleanPointInPolygon(turfPoint(here), poly.geom);
      } catch {
        inside = false;
      }
      if (inside) {
        hit = poly.geoid;
        break;
      }
    }
    if (hit === null) {
      let best = Infinity;
      for (const c of centroids) {
        if (!c.centroid) continue;
        const d = distanceMeters(here, c.centroid);
        if (d < best) {
          best = d;
          hit = c.geoid;
        }
      }
    }
    if (hit !== null) out.set(pt.id, hit);
  }
  return out;
}

// ---------- Census geocoder fallback ----------

export function geocoderCoordinatesUrl(lng: number, lat: number): string {
  const u = new URL(CENSUS_GEOCODER_COORDINATES);
  u.searchParams.set("x", String(lng));
  u.searchParams.set("y", String(lat));
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("vintage", "Current_Current");
  u.searchParams.set("format", "json");
  return u.toString();
}

/** One point → its block-group GEOID via the Census geocoder, or null when it reports none. */
export async function geocodeBlockGroup(lng: number, lat: number, opts: { fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? fetch;
  const json = await getJson<{ result?: { geographies?: Record<string, Array<Record<string, unknown>>> } }>(
    f,
    geocoderCoordinatesUrl(lng, lat),
    "census geocoder",
  );
  const geos = json.result?.geographies ?? {};
  const key = Object.keys(geos).find((k) => k === BLOCK_GROUP_LAYER_NAME) ?? Object.keys(geos).find((k) => /block group/i.test(k));
  const first = key ? geos[key]?.[0] : undefined;
  return first ? geoidOf(first) : null;
}

/**
 * Geocoder lookup for many points with at most `concurrency` (default 2) requests in flight. A point whose lookup
 * fails is left out (the caller can retry later); the others still resolve.
 */
export async function geocodeBlockGroups(
  points: PointToAssign[],
  opts: { fetchImpl?: typeof fetch; concurrency?: number; onError?: (point: PointToAssign, err: unknown) => void } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const workers = Math.max(1, opts.concurrency ?? GEOCODER_CONCURRENCY);
  let next = 0;
  const run = async () => {
    while (next < points.length) {
      const pt = points[next++];
      if (!Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) continue;
      try {
        const geoid = await geocodeBlockGroup(pt.lng, pt.lat, { fetchImpl: opts.fetchImpl });
        if (geoid) out.set(pt.id, geoid);
      } catch (err) {
        opts.onError?.(pt, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, points.length) }, run));
  return out;
}

/**
 * The whole procedure for a pulled area: TIGERweb polygons for the bbox + local point-in-polygon; any point still
 * unassigned (or every point, when TIGERweb returned nothing) goes to the geocoder fallback.
 */
export async function resolveBlockGroups(
  points: PointToAssign[],
  bbox: Bbox,
  opts: { fetchImpl?: typeof fetch; serviceUrl?: string; onError?: (point: PointToAssign, err: unknown) => void } = {},
): Promise<{ assigned: Map<string, string>; polygons: BlockGroupPolygon[]; viaGeocoder: number }> {
  let polygons: BlockGroupPolygon[] = [];
  try {
    polygons = await fetchBlockGroupPolygons(bbox, { fetchImpl: opts.fetchImpl, serviceUrl: opts.serviceUrl });
  } catch (err) {
    opts.onError?.({ id: "*", lng: bbox[0], lat: bbox[1] }, err);
  }
  const assigned = assignBlockGroups(points, polygons);
  const missing = points.filter((p) => !assigned.has(p.id));
  if (missing.length > 0) {
    const fallback = await geocodeBlockGroups(missing, { fetchImpl: opts.fetchImpl, onError: opts.onError });
    fallback.forEach((geoid, id) => assigned.set(id, geoid));
    return { assigned, polygons, viaGeocoder: fallback.size };
  }
  return { assigned, polygons, viaGeocoder: 0 };
}
