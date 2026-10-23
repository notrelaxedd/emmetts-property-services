import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/ops/test-utils";
import type { AdminClient } from "@/lib/supabase/admin";
import {
  CELL_DEG,
  DUE_AFTER_DAYS,
  MAX_LOAD_SPAN,
  cellsBbox,
  cellsFor,
  coverageStatus,
  daysBetween,
  overpassQuery,
  parseBbox,
  parseOverpass,
  sameStreet,
} from "./streets";

vi.mock("server-only", () => ({}));

/** Overpass `out geom` response shape (fixture). */
const overpass = {
  elements: [
    {
      type: "way",
      id: 101,
      bounds: { minlat: 41.481, minlon: -81.84, maxlat: 41.482, maxlon: -81.838 },
      geometry: [
        { lat: 41.4810004, lon: -81.84 },
        { lat: 41.482, lon: -81.838 },
      ],
      tags: { highway: "residential", name: "Elm St" },
    },
    {
      type: "way",
      id: 102,
      geometry: [
        { lat: 41.482, lon: -81.838 },
        { lat: 41.483, lon: -81.836 },
        { lat: 41.4835, lon: -81.835 },
      ],
      tags: { highway: "residential", name: "Elm St" },
    },
    { type: "way", id: 103, geometry: [{ lat: 41.48, lon: -81.83 }, { lat: 41.481, lon: -81.83 }], tags: { highway: "residential" } },
    { type: "way", id: 104, geometry: [{ lat: 41.48, lon: -81.83 }], tags: { highway: "residential", name: "Stub Ct" } },
    { type: "node", id: 105, lat: 41.48, lon: -81.83, tags: { name: "Not a street" } },
  ],
};

describe("bbox and grid", () => {
  it("parses south,west,north,east inside Northeast Ohio only", () => {
    expect(parseBbox("41.47,-81.86,41.49,-81.84", MAX_LOAD_SPAN)).toEqual({ south: 41.47, west: -81.86, north: 41.49, east: -81.84 });
    expect(parseBbox("41.49,-81.86,41.47,-81.84", MAX_LOAD_SPAN)).toBeNull(); // inverted
    expect(parseBbox("41,-82,42,-81", MAX_LOAD_SPAN)).toBeNull(); // too big to load
    expect(parseBbox("39.9,-83.1,39.95,-83.0", MAX_LOAD_SPAN)).toBeNull(); // Columbus
    expect(parseBbox("abc", MAX_LOAD_SPAN)).toBeNull();
    expect(parseBbox(null, MAX_LOAD_SPAN)).toBeNull();
  });

  it("splits a view into grid cells and back", () => {
    const cells = cellsFor({ south: 41.47, west: -81.86, north: 41.49, east: -81.84 });
    expect(cells).toEqual(["2073:-4093", "2073:-4092", "2074:-4093", "2074:-4092"]);
    const b = cellsBbox(cells);
    expect(b).toEqual({ south: 41.46, west: -81.86, north: 41.5, east: -81.82 });
    expect(b.north - b.south).toBeCloseTo(2 * CELL_DEG);
  });

  it("asks Overpass for named walkable streets with geometry", () => {
    const q = overpassQuery({ south: 41.46, west: -81.86, north: 41.5, east: -81.82 });
    expect(q).toContain('way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|primary)$"]["name"](41.46,-81.86,41.5,-81.82)');
    expect(q).toContain("out geom;");
  });
});

describe("parseOverpass", () => {
  it("keeps named ways with 2+ points, rounding to ~1 m", () => {
    const streets = parseOverpass(overpass);
    expect(streets.map((s) => s.osm_id)).toEqual([101, 102]);
    expect(streets[0]).toEqual({
      osm_id: 101,
      name: "Elm St",
      kind: "residential",
      path: [
        [41.481, -81.84],
        [41.482, -81.838],
      ],
      min_lat: 41.481,
      max_lat: 41.482,
      min_lng: -81.84,
      max_lng: -81.838,
    });
  });

  it("rejects a response without elements", () => {
    expect(() => parseOverpass({ remark: "runtime error" })).toThrow(/no elements/);
  });
});

describe("coverage", () => {
  it(`is green for ${DUE_AFTER_DAYS} days, then due again`, () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(coverageStatus(null, "2026-10-31")).toBe("never");
    expect(coverageStatus("2026-10-31", "2026-10-31")).toBe("covered");
    expect(coverageStatus("2026-10-01", "2026-10-31")).toBe("covered");
    expect(coverageStatus("2026-09-30", "2026-10-31")).toBe("due");
  });

  it("whole street = same name nearby, not the same name in another town", () => {
    const s = (id: string, name: string, lat: number) => ({ id, name, path: [[lat, -81.84], [lat + 0.001, -81.84]] as [number, number][] });
    const tapped = s("a", "Elm St", 41.48);
    const all = [tapped, s("b", "elm st", 41.485), s("c", "Oak Ave", 41.48), s("d", "Elm St", 41.6)];
    expect(sameStreet(tapped, all).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("street loading", () => {
  const view = { south: 41.47, west: -81.86, north: 41.49, east: -81.84 };

  it("loads unseen cells from OpenStreetMap once, then serves them from the database", async () => {
    const { ensureStreets, streetsInView } = await import("./street-data");
    const db = fakeDb() as unknown as AdminClient;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(overpass), { status: 200 }));

    expect(await ensureStreets(db, view, fetchImpl as unknown as typeof fetch)).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("data")).toContain("(41.46,-81.86,41.5,-81.82)");

    // Second look: nothing to fetch.
    expect(await ensureStreets(db, view, fetchImpl as unknown as typeof fetch)).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const tables = (db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables;
    expect(tables.flyer_streets).toHaveLength(2);
    expect(tables.flyer_street_areas.map((a) => a.cell).sort()).toEqual(["2073:-4092", "2073:-4093", "2074:-4092", "2074:-4093"]);

    const elm = tables.flyer_streets.find((s) => s.osm_id === 102)!;
    tables.flyer_street_marks = [
      { id: "m1", street_id: elm.id, covered_on: "2026-09-01", flyer_worker_id: null, created_at: "2026-09-01T00:00:00Z" },
      { id: "m2", street_id: elm.id, covered_on: "2026-10-20", flyer_worker_id: "w1", created_at: "2026-10-20T00:00:00Z" },
    ];
    // Street 102 sits just east of `view`; widen the view to take in both.
    expect((await streetsInView(db, view)).map((s) => s.id)).not.toContain(elm.id);
    const streets = await streetsInView(db, { ...view, east: -81.83 });
    expect(streets).toHaveLength(2);
    expect(streets.find((s) => s.id === elm.id)?.last).toEqual({ markId: "m2", coveredOn: "2026-10-20", workerId: "w1" });
    expect(streets.find((s) => s.id !== elm.id)?.last).toBeNull();

    // A view that doesn't overlap any street returns nothing.
    expect(await streetsInView(db, { south: 41.6, west: -81.7, north: 41.61, east: -81.69 })).toEqual([]);
  });

  it("re-loading the same OSM ways updates them instead of duplicating", async () => {
    const { ensureStreets } = await import("./street-data");
    const db = fakeDb({ flyer_street_areas: [] }) as unknown as AdminClient;
    const ok = async () => new Response(JSON.stringify(overpass), { status: 200 });
    await ensureStreets(db, view, ok as unknown as typeof fetch);
    await ensureStreets(db, { south: 41.5, west: -81.86, north: 41.51, east: -81.84 }, ok as unknown as typeof fetch);
    const tables = (db as unknown as { tables: Record<string, unknown[]> }).tables;
    expect(tables.flyer_streets).toHaveLength(2);
  });

  it("surfaces an OpenStreetMap failure and marks nothing as loaded", async () => {
    const { ensureStreets } = await import("./street-data");
    const db = fakeDb() as unknown as AdminClient;
    const busy = async () => new Response("Too Many Requests", { status: 429 });
    await expect(ensureStreets(db, view, busy as unknown as typeof fetch)).rejects.toThrow(/429/);
    const tables = (db as unknown as { tables: Record<string, unknown[]> }).tables;
    expect(tables.flyer_street_areas ?? []).toHaveLength(0);
  });
});

describe("paging past the 1000-row API limit", () => {
  it("allPages keeps reading until a short page", async () => {
    const { allPages } = await import("./paged");
    const db = fakeDb({
      flyer_scans: Array.from({ length: 2345 }, (_, i) => ({ id: String(i).padStart(5, "0"), flyer_worker_id: "w", visitor: `v${i}` })),
    });
    const calls: [number, number][] = [];
    const rows = await allPages((a, b) => {
      calls.push([a, b]);
      return db.from("flyer_scans").select("id").order("id").range(a, b);
    }, "scans");
    expect(rows).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(await allPages((a, b) => db.from("flyer_scans").select("id").order("id").range(a, b), "scans", 1500)).toHaveLength(1500);
  });

  it("flyer stats count every scan, not just the first 1000", async () => {
    const { loadFlyerFunnels } = await import("./load");
    const db = fakeDb({
      flyer_scans: Array.from({ length: 1500 }, (_, i) => ({ id: String(i).padStart(5, "0"), flyer_worker_id: "w", visitor: `v${i}` })),
    }) as unknown as AdminClient;
    const { funnels } = await loadFlyerFunnels(db);
    expect(funnels.get("w")?.scans).toBe(1500);
  });
});
