/**
 * Flyer map street logic. Pure (no I/O) so it's unit-testable; lib/flyers/street-data.ts does the
 * database and OpenStreetMap (Overpass API) calls.
 *
 * Streets load lazily: the map asks for the streets in view, and any 0.02° grid cell not seen
 * before is fetched from Overpass once and stored. That keeps all of Northeast Ohio available
 * without preloading it.
 */

export type Bbox = { south: number; west: number; north: number; east: number };

/** Where the map may load streets: Northeast Ohio, with some room around the edges. */
export const SERVICE_BOUNDS: Bbox = { south: 40.4, west: -82.9, north: 42.0, east: -80.5 };

/** Grid cell size in degrees (~2.2 km north–south, ~1.7 km east–west here). */
export const CELL_DEG = 0.02;

/** Largest view that loads streets from OpenStreetMap (degrees each way); bigger views show covered streets only. */
export const MAX_LOAD_SPAN = 0.12;
/** Largest view for the zoomed-out "covered streets only" layer. */
export const MAX_COVERED_SPAN = 2;

/** A street covered this many days ago (or fewer) is done; after that it's due again. */
export const DUE_AFTER_DAYS = 30;

/** Road types worth walking: no motorways, ramps, driveways or footpaths. Unnamed ways are skipped too. */
export const STREET_KINDS = ["residential", "living_street", "unclassified", "tertiary", "secondary", "primary"] as const;

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** "south,west,north,east" -> Bbox, or null if malformed, inverted, outside NE Ohio or wider than `maxSpan`. */
export function parseBbox(raw: string | null | undefined, maxSpan: number): Bbox | null {
  const parts = (raw ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) return null;
  if (north - south > maxSpan || east - west > maxSpan) return null;
  const b = SERVICE_BOUNDS;
  if (north < b.south || south > b.north || east < b.west || west > b.east) return null;
  return { south, west, north, east };
}

const idx = (deg: number) => Math.floor(deg / CELL_DEG + 1e-9);

/** Grid cells ("<lat idx>:<lng idx>") covering a box. */
export function cellsFor(bbox: Bbox): string[] {
  const out: string[] = [];
  for (let i = idx(bbox.south); i <= idx(bbox.north); i++) {
    for (let j = idx(bbox.west); j <= idx(bbox.east); j++) out.push(`${i}:${j}`);
  }
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The box a set of cells spans. */
export function cellsBbox(cells: readonly string[]): Bbox {
  const ij = cells.map((c) => c.split(":").map(Number));
  const is = ij.map(([i]) => i);
  const js = ij.map(([, j]) => j);
  return {
    south: round6(Math.min(...is) * CELL_DEG),
    west: round6(Math.min(...js) * CELL_DEG),
    north: round6((Math.max(...is) + 1) * CELL_DEG),
    east: round6((Math.max(...js) + 1) * CELL_DEG),
  };
}

/** Overpass QL for the named, walkable streets in a box, with their geometry. */
export function overpassQuery(bbox: Bbox): string {
  return (
    `[out:json][timeout:25];` +
    `way["highway"~"^(${STREET_KINDS.join("|")})$"]["name"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`
  );
}

export type StreetInput = {
  osm_id: number;
  name: string;
  kind: string;
  path: [number, number][];
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
};

type OverpassWay = {
  type?: string;
  id?: number;
  tags?: { highway?: string; name?: string };
  geometry?: ({ lat?: number; lon?: number } | null)[];
};

const round5 = (n: number) => Math.round(n * 1e5) / 1e5; // ~1 m

/** Overpass JSON -> street rows. Skips anything that isn't a named way with at least two points. */
export function parseOverpass(json: unknown): StreetInput[] {
  const elements = (json as { elements?: OverpassWay[] } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error("Overpass response has no elements");
  const out: StreetInput[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (el.type !== "way" || typeof el.id !== "number" || !name || !el.tags?.highway) continue;
    const path: [number, number][] = [];
    for (const p of el.geometry ?? []) {
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) path.push([round5(p.lat!), round5(p.lon!)]);
    }
    if (path.length < 2) continue;
    const lats = path.map((p) => p[0]);
    const lngs = path.map((p) => p[1]);
    out.push({
      osm_id: el.id,
      name: name.slice(0, 120),
      kind: el.tags.highway,
      path,
      min_lat: Math.min(...lats),
      max_lat: Math.max(...lats),
      min_lng: Math.min(...lngs),
      max_lng: Math.max(...lngs),
    });
  }
  return out;
}

export type CoverageStatus = "never" | "covered" | "due";

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** never = no flyers yet; covered = within DUE_AFTER_DAYS of `today`; due = older than that. */
export function coverageStatus(lastCoveredOn: string | null | undefined, today: string): CoverageStatus {
  if (!lastCoveredOn) return "never";
  return daysBetween(lastCoveredOn, today) <= DUE_AFTER_DAYS ? "covered" : "due";
}

/** Rough distance in metres between two [lat, lng] points (equirectangular; fine at street scale). */
export function metresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * "Whole street": every loaded segment with the same name whose midpoint is within `radius` metres of
 * the tapped one, so a same-named street in the next town over isn't swept in.
 */
export function sameStreet<T extends { id: string; name: string; path: [number, number][] }>(
  tapped: T,
  streets: Iterable<T>,
  radius = 2500,
): T[] {
  const mid = (s: T) => s.path[Math.floor(s.path.length / 2)];
  const name = tapped.name.toLowerCase();
  const out: T[] = [];
  for (const s of Array.from(streets)) {
    if (s.name.toLowerCase() === name && metresBetween(mid(tapped), mid(s)) <= radius) out.push(s);
  }
  return out;
}
