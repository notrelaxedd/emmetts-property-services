import { describe, expect, it } from "vitest";
import { fakeDb } from "../ops/test-utils";
import {
  bboxAround,
  loadCanvassStats,
  loadLatestSummary,
  loadNearbyParcels,
  loadParcelDetail,
  loadParcelViews,
  loadStreets,
  loadTodayPlan,
  pickStreetCode,
  searchParcels,
  stopsFromViews,
  toNearbyParcel,
} from "./load";
import { blockGroupRow, canvassSettingsRow, knockRow, parcelRow } from "./rows.fixture";

const GEOID = "390351621021";
const profiles = [
  { id: "knocker-a", user_id: "u1", role: "crew", name: "Emmett" },
  { id: "knocker-b", user_id: "u2", role: "crew", name: "Sam" },
];

function seed() {
  const a = parcelRow({ block_group_geoid: GEOID, address: "19000 DETROIT RD", parcel_id: "PIN-A", fetched_at: "2026-10-02T00:00:00Z" });
  const b = parcelRow({ block_group_geoid: GEOID, address: "19004 DETROIT RD", parcel_id: "PIN-B", centroid_lng: -81.8392, fetched_at: "2026-10-03T00:00:00Z" });
  const c = parcelRow({ block_group_geoid: null, address: "100 ELM ST", street: "ELM ST", parcel_id: "PIN-C", do_not_knock: true, centroid_lat: 41.48, fetched_at: "2026-10-01T00:00:00Z" });
  const db = fakeDb({
    canvass_settings: [canvassSettingsRow()],
    parcels: [a, b, c],
    block_groups: [blockGroupRow({ geoid: GEOID })],
    knocks: [
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-20T21:00:00.000Z", outcome: "no_answer", knocker_id: "knocker-a" }),
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-28T21:00:00.000Z", outcome: "booked", knocker_id: "knocker-b", pitch_id: "p1" }),
    ],
    profiles: profiles as never,
    pitches: [{ id: "p1", name: "Neighbor special", script: "", active: true, sort_order: 0 }],
    customers: [{ id: "cust-1", name: "Jane", address: "19002 Detroit Rd", lat: null, lng: null, parcel_id: null }],
    hanger_codes: [
      { id: "hc-1", code: "K7M2", street: "DETROIT RD", block_group_geoid: GEOID, active: false, created_at: "2026-10-01T00:00:00Z" },
      { id: "hc-2", code: "XQ9P", street: "DETROIT RD", block_group_geoid: GEOID, active: true, created_at: "2026-10-02T00:00:00Z" },
    ],
    hanger_events: [
      { id: "e1", code: "XQ9P", event: "scan", visitor: "v1", lead_id: null },
      { id: "e2", code: "XQ9P", event: "scan", visitor: "v1", lead_id: null },
      { id: "e3", code: "XQ9P", event: "booking", visitor: null, lead_id: "lead-1" },
    ],
  });
  return { db, a, b, c };
}

describe("loadParcelViews", () => {
  it("loads newest-fetched first with window, quote, score, last knock and customer count", async () => {
    const { db, a, b, c } = seed();
    const r = await loadParcelViews(db);
    expect(r.parcels.map((p) => p.id)).toEqual([b.id, a.id, c.id]);
    expect(r.settings.doors_per_hour).toBe(25);
    expect(r.season.service).toBeDefined();
    const va = r.parcels.find((p) => p.id === a.id)!;
    expect(va.window.source).toBe("acs");
    expect(va.lastKnock).toEqual({ knocked_at: "2026-10-28T21:00:00.000Z", outcome: "booked", knocker_name: "Sam" });
    expect(va.knockCount).toBe(2);
    expect(va.breakdown.neighborBoost).toBe(1.5); // customer at 19002
    expect(va.score).toBeGreaterThan(0);
    const vc = r.parcels.find((p) => p.id === c.id)!;
    expect(vc.score).toBe(0);
    expect(r.customersCount).toBe(0);
  });
  it("honours ids (in the given order) and the limit", async () => {
    const { db, a, c } = seed();
    const r = await loadParcelViews(db, { ids: [c.id, a.id, "missing"] });
    expect(r.parcels.map((p) => p.id)).toEqual([c.id, a.id]);
    expect((await loadParcelViews(db, { limit: 1 })).parcels).toHaveLength(1);
  });
});

describe("learned window pooling", () => {
  it("pools the whole block group's knocks, so one house's detail page agrees with the table", async () => {
    const houses = Array.from({ length: 10 }, (_, i) =>
      parcelRow({ block_group_geoid: GEOID, address: `${19000 + i * 2} DETROIT RD`, parcel_id: `PIN-${i}`, fetched_at: "2026-10-02T00:00:00Z" }),
    );
    // One knock per house: 10 knocks in the block group (>= learned_min_knocks 8), but only 1 on any single house.
    const db = fakeDb({
      canvass_settings: [canvassSettingsRow()],
      parcels: houses,
      block_groups: [blockGroupRow({ geoid: GEOID })],
      knocks: houses.map((h) => knockRow({ parcel_id: h.id, knocked_at: "2026-10-27T23:15:00.000Z", outcome: "quote_given" })),
      profiles: profiles as never,
      customers: [],
    });
    const table = await loadParcelViews(db);
    const fromTable = table.parcels.find((p) => p.id === houses[3].id)!;
    expect(fromTable.window.source).toBe("learned");
    const detail = await loadParcelDetail(db, houses[3].id);
    expect(detail!.parcel.window.source).toBe("learned");
    expect(detail!.parcel.window.label).toBe(fromTable.window.label);
    const views = await loadParcelViews(db, { ids: [houses[3].id] });
    expect(views.parcels[0].window.label).toBe(fromTable.window.label);
  });
});

describe("loadParcelDetail", () => {
  it("returns the view plus the knock history with names, or null", async () => {
    const { db, a } = seed();
    const r = await loadParcelDetail(db, a.id);
    expect(r?.parcel.id).toBe(a.id);
    expect(r?.knocks.map((k) => [k.knocker_name, k.pitch_name, k.address])).toEqual([
      ["Sam", "Neighbor special", "19000 DETROIT RD"],
      ["Emmett", null, "19000 DETROIT RD"],
    ]);
    expect(await loadParcelDetail(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("nearby helpers", () => {
  it("bboxAround covers the radius and toNearbyParcel carries the logger fields", async () => {
    const box = bboxAround(41.4756, -81.8396, 250);
    expect(box.maxLat - box.minLat).toBeCloseTo(0.0045, 3);
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
    const { db, a } = seed();
    const { parcels } = await loadParcelViews(db, { ids: [a.id] });
    const n = toNearbyParcel(parcels[0], 12.6);
    expect(n).toMatchObject({ id: a.id, address: "19000 DETROIT RD", meters: 13, isCustomer: false });
    expect(n.quoteLabel).toMatch(/^\$\d+–\$\d+$/);
    expect(Object.keys(n)).not.toContain("raw");
  });

  it("loadNearbyParcels returns houses inside the radius, closest first, and nothing for a bad point", async () => {
    const { db, a, b } = seed();
    const near = await loadNearbyParcels(db, a.centroid_lat as number, a.centroid_lng as number, 250, 40);
    expect(near.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(near[0].meters).toBe(0);
    expect(near[1].meters).toBeGreaterThan(0);
    expect(near[1].meters).toBeLessThanOrEqual(250);
    expect(await loadNearbyParcels(db, a.centroid_lat as number, a.centroid_lng as number, 10, 40)).toHaveLength(1);
    expect(await loadNearbyParcels(db, Number.NaN, 0)).toEqual([]);
  });

  it("searchParcels matches the address case-insensitively with meters 0", async () => {
    const { db, a, b } = seed();
    const hits = await searchParcels(db, "detroit");
    expect(hits.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(hits.every((p) => p.meters === 0 && p.quoteLabel.startsWith("$"))).toBe(true);
    expect(await searchParcels(db, "   ")).toEqual([]);
    expect(await searchParcels(db, "nowhere")).toEqual([]);
  });
});

describe("summary, stats, streets, plan", () => {
  it("loadLatestSummary returns the newest row or null", async () => {
    const db = fakeDb();
    expect(await loadLatestSummary(db)).toBeNull();
    db.tables.canvass_summaries = [
      { id: "s1", for_date: "2026-10-28", summary: { headline: "old" }, model: null, created_at: "2026-10-29T10:00:00Z" },
      { id: "s2", for_date: "2026-10-29", summary: { headline: "new" }, model: null, created_at: "2026-10-30T10:00:00Z" },
    ];
    const s = await loadLatestSummary(db);
    expect(s?.for_date).toBe("2026-10-29");
    expect((s?.summary as { headline: string }).headline).toBe("new");
  });
  it("loadCanvassStats joins names and counts hanger conversions and totals", async () => {
    const { db } = seed();
    const r = await loadCanvassStats(db);
    expect(r.byKnocker.map((k) => [k.name, k.knocks, k.closes])).toEqual(expect.arrayContaining([["Emmett", 1, 0], ["Sam", 1, 1]]));
    expect(r.byPitch.find((p) => p.name === "Neighbor special")?.knocks).toBe(1);
    expect(r.hangers).toEqual([
      { code: "K7M2", street: "DETROIT RD", scans: 0, bookings: 0, rate: null },
      { code: "XQ9P", street: "DETROIT RD", scans: 1, bookings: 1, rate: 1 },
    ]);
    expect(r.pitches).toHaveLength(1);
    expect(r.totals).toEqual({ knocks: 2, parcels: 3, doNotKnock: 1, customers: 0 });
  });
  it("loadStreets groups parcels by street with the active code", async () => {
    const { db } = seed();
    const r = await loadStreets(db);
    expect(r.map((s) => [s.street, s.parcels, s.block_group_geoid, s.code?.code ?? null])).toEqual([
      ["DETROIT RD", 2, GEOID, "XQ9P"],
      ["ELM ST", 1, null, null],
    ]);
    expect(pickStreetCode([])).toBeNull();
  });
  it("loadTodayPlan returns the saved stops in order, dropping do-not-knock houses", async () => {
    const { db, a, b, c } = seed();
    expect(await loadTodayPlan(db, "2026-10-30")).toBeNull();
    db.tables.canvass_plans = [
      { id: "pl1", for_date: "2026-10-30", slot_start: "15:00", slot_end: "17:00", parcel_ids: [b.id, c.id, a.id], created_by: null, notes: null, created_at: "2026-10-29T00:00:00Z" },
    ];
    const r = await loadTodayPlan(db, "2026-10-30");
    expect(r?.plan.id).toBe("pl1");
    expect(r?.stops.map((s) => [s.order, s.id])).toEqual([
      [1, b.id],
      [2, a.id],
    ]);
    expect(r?.stops[1].walkMeters).toBeGreaterThan(0);
    const stops = stopsFromViews([], null);
    expect(stops).toEqual([]);
  });
});
