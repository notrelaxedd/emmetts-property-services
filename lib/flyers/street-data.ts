import "server-only";
import { check } from "@/lib/ops/types";
import type { AdminClient } from "@/lib/supabase/admin";
import { allPages } from "./paged";
import { OVERPASS_URL, cellsBbox, cellsFor, overpassQuery, parseOverpass, type Bbox } from "./streets";

/** Ids per `.in()` filter, keeping PostgREST URLs short. */
const CHUNK = 100;
/** Most streets returned for one view. */
const MAX_STREETS = 6000;

export type MapStreet = {
  id: string;
  name: string;
  kind: string;
  path: [number, number][];
  /** Newest mark, if the street has ever been flyered. */
  last: { markId: string; coveredOn: string; workerId: string | null } | null;
};

/**
 * Load any grid cells in `bbox` not seen before from OpenStreetMap (one Overpass call for all of
 * them) and store their streets. Returns how many cells were loaded.
 */
export async function ensureStreets(db: AdminClient, bbox: Bbox, fetchImpl: typeof fetch = fetch): Promise<number> {
  const cells = cellsFor(bbox);
  const known = check(await db.from("flyer_street_areas").select("cell").in("cell", cells), "street areas") ?? [];
  const have = new Set(known.map((k) => k.cell));
  const missing = cells.filter((c) => !have.has(c));
  if (!missing.length) return 0;

  const res = await fetchImpl(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "emmetts-property-services flyer map" },
    body: new URLSearchParams({ data: overpassQuery(cellsBbox(missing)) }),
    signal: AbortSignal.timeout(28_000),
  });
  if (!res.ok) throw new Error(`OpenStreetMap street lookup failed (${res.status})`);
  const streets = parseOverpass(await res.json());

  for (let i = 0; i < streets.length; i += 500) {
    check(
      await db.from("flyer_streets").upsert(streets.slice(i, i + 500), { onConflict: "osm_id" }),
      "save streets",
    );
  }
  // Rough per-cell count, just for reference: streets whose start point is in the cell.
  const counts = new Map(missing.map((c) => [c, 0]));
  for (const s of streets) {
    const key = cellsFor({ south: s.path[0][0], west: s.path[0][1], north: s.path[0][0], east: s.path[0][1] })[0];
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  check(
    await db
      .from("flyer_street_areas")
      .upsert(missing.map((cell) => ({ cell, street_count: counts.get(cell) ?? 0 })), { onConflict: "cell" }),
    "save street areas",
  );
  return missing.length;
}

/** Newest mark per street id. */
async function latestMarks(db: AdminClient, streetIds: string[]): Promise<Map<string, MapStreet["last"]>> {
  const out = new Map<string, MapStreet["last"]>();
  for (let i = 0; i < streetIds.length; i += CHUNK) {
    const ids = streetIds.slice(i, i + CHUNK);
    const rows = await allPages(
      (a, b) =>
        db
          .from("flyer_street_marks")
          .select("id,street_id,covered_on,flyer_worker_id")
          .in("street_id", ids)
          .order("covered_on", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id")
          .range(a, b),
      "street marks",
    );
    for (const m of rows) {
      if (!out.has(m.street_id)) out.set(m.street_id, { markId: m.id, coveredOn: m.covered_on, workerId: m.flyer_worker_id });
    }
  }
  return out;
}

type StreetRow = { id: string; name: string; kind: string; path: [number, number][] };

function overlapping<Q extends { lte: (c: string, v: number) => Q; gte: (c: string, v: number) => Q }>(q: Q, b: Bbox): Q {
  return q.lte("min_lat", b.north).gte("max_lat", b.south).lte("min_lng", b.east).gte("max_lng", b.west);
}

/** Every stored street in view, with its newest mark. */
export async function streetsInView(db: AdminClient, bbox: Bbox): Promise<MapStreet[]> {
  const rows = (await allPages(
    (a, b) => overlapping(db.from("flyer_streets").select("id,name,kind,path"), bbox).order("id").range(a, b),
    "streets",
    MAX_STREETS,
  )) as StreetRow[];
  const marks = await latestMarks(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, last: marks.get(r.id) ?? null }));
}

/** Zoomed out: only streets that have been flyered, in view. */
export async function coveredStreetsInView(db: AdminClient, bbox: Bbox): Promise<MapStreet[]> {
  const marked = await allPages(
    (a, b) => db.from("flyer_street_marks").select("id,street_id").order("id").range(a, b),
    "marked streets",
    50_000,
  );
  const ids = Array.from(new Set(marked.map((m) => m.street_id)));
  const rows: StreetRow[] = [];
  for (let i = 0; i < ids.length && rows.length < MAX_STREETS; i += CHUNK) {
    rows.push(
      ...((check(
        await overlapping(db.from("flyer_streets").select("id,name,kind,path").in("id", ids.slice(i, i + CHUNK)), bbox),
        "covered streets",
      ) ?? []) as StreetRow[]),
    );
  }
  const marks = await latestMarks(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, last: marks.get(r.id) ?? null }));
}
