import { describe, expect, it } from "vitest";
import { fakeDb } from "../ops/test-utils";
import {
  bboxAround,
  crewSafeStops,
  loadCanvassStats,
  loadLatestSummary,
  loadParcelDetail,
  loadParcelViews,
  loadStreets,
  loadTodayPlan,
  loadWalk,
  pickStreetCode,
  slotAt,
  stopsFromViews,
} from "./load";
import { blockGroupRow, canvassSettingsRow, knockRow, parcelRow } from "./rows.fixture";

const GEOID = "390351621021";
/** Thu 2026-10-29 5:15pm in Ohio: inside the seeded block group's weekdays 4-6pm window. */
const THU_EVENING = new Date("2026-10-29T21:15:00.000Z");
const SAT_MORNING = new Date("2026-10-31T14:00:00.000Z");
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
  it("loads newest-fetched first with window, light, simple score, last knock and customer count", async () => {
    const { db, a, b, c } = seed();
    const r = await loadParcelViews(db, { now: THU_EVENING });
    expect(r.parcels.map((p) => p.id)).toEqual([b.id, a.id, c.id]);
    expect(r.settings.doors_per_hour).toBe(25);
    expect(r.season.service).toBeDefined();
    const va = r.parcels.find((p) => p.id === a.id)!;
    expect(va.window.source).toBe("acs");
    expect(va.lastKnock).toEqual({ knocked_at: "2026-10-28T21:00:00.000Z", outcome: "booked", knocker_name: "Sam" });
    expect(va.knockCount).toBe(2);
    expect(va.fullAddress).toBe("19000 Detroit Rd, Rocky River, OH 44116");
    expect(va.knock.light).toBe("green");
    expect(va.simple.breakdown.customer).toBe(3); // customer at 19002
    expect(va.simple.points).toBeGreaterThan(0);
    expect(va.medianIncome).toBe(85000);
    const vc = r.parcels.find((p) => p.id === c.id)!;
    expect(vc.simple.points).toBe(0);
    expect(vc.knock.light).toBe("red");
    expect(r.customersCount).toBe(0);
  });
  it("judges the light in the requested slot", async () => {
    const { db, a } = seed();
    const sat = await loadParcelViews(db, { ids: [a.id], slot: { at: SAT_MORNING } });
    expect(sat.parcels[0].knock.light).toBe("red");
    expect(sat.parcels[0].knock.nextGoodTime).toBe("Monday 4pm");
    const thu = await loadParcelViews(db, { ids: [a.id], slot: slotAt("2026-10-29", "17:15") });
    expect(thu.parcels[0].knock.light).toBe("green");
  });
  it("slotAt reads local Ohio time and rejects junk", () => {
    expect(slotAt("2026-10-29", "17:15")?.at.toISOString()).toBe("2026-10-29T21:15:00.000Z");
    expect(slotAt("2026-10-29", "17:15:00")?.at.toISOString()).toBe("2026-10-29T21:15:00.000Z");
    expect(slotAt("nope", "17:15")).toBeNull();
    expect(slotAt("2026-10-29", "late")).toBeNull();
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

describe("bboxAround", () => {
  it("covers the radius, wider in longitude than latitude away from the equator", () => {
    const box = bboxAround(41.4756, -81.8396, 250);
    expect(box.maxLat - box.minLat).toBeCloseTo(0.0045, 3);
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
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
    expect(r?.stops[0].fullAddress).toBe("19004 Detroit Rd, Rocky River, OH 44116");
    expect(r?.stops[0].knock.light).toBe("yellow"); // judged at the plan's 3pm start: an hour before the 4-6pm window
    expect(typeof r?.stops[0].score).toBe("number");
    // Crew copies drop the owner-only numbers.
    const crew = crewSafeStops(r!.stops);
    expect(crew.map((s) => s.id)).toEqual(r!.stops.map((s) => s.id));
    expect(crew.every((s) => s.score === 0 && s.quote.profit === null && s.quote.laborCost === null && !s.quote.underCost)).toBe(true);
    expect(crew[0].quote.label).toBe(r!.stops[0].quote.label);
    const stops = stopsFromViews([], null);
    expect(stops).toEqual([]);
  });
});

describe("loadWalk", () => {
  const HOUSES = 8;
  function walkSeed(settingsOver: Parameters<typeof canvassSettingsRow>[0] = {}) {
    const houses = Array.from({ length: HOUSES }, (_, i) =>
      parcelRow({
        block_group_geoid: GEOID,
        address: `${19000 + i * 2} DETROIT RD`,
        parcel_id: `PIN-W${i}`,
        centroid_lng: -81.8396 + i * 0.0003,
        owner_display: i === 0 ? "GARCIA MARIA" : "SMITH JOHN",
        callback_window: i === 1 ? "weekdays after 5" : null,
      }),
    );
    const db = fakeDb({
      canvass_settings: [canvassSettingsRow(settingsOver)],
      parcels: houses,
      block_groups: [blockGroupRow({ geoid: GEOID })],
      knocks: [],
      profiles: profiles as never,
      customers: [],
      pitches: [
        { id: "p1", name: "Neighbor special", script: "Hi!", active: true, sort_order: 0 },
        { id: "p2", name: "Retired", script: "Old", active: false, sort_order: 1 },
      ],
    });
    return { db, houses };
  }
  const start = { lat: 41.4756, lng: -81.8396 };

  it("returns the next doors in walking order with crew-safe fields", async () => {
    const { db, houses } = walkSeed();
    const r = await loadWalk(db, { ...start, now: THU_EVENING });
    expect(r.stops).toHaveLength(HOUSES);
    expect(r.stops.map((s) => s.order)).toEqual(houses.map((_, i) => i + 1));
    const first = r.stops[0];
    expect(first.id).toBe(houses[0].id);
    expect(first).toMatchObject({
      fullAddress: "19000 Detroit Rd, Rocky River, OH 44116",
      ownerFirstName: "Maria",
      quoteLabel: "$40",
      light: "green",
      callback_window: null,
    });
    expect(first.pitch).toBe(r.season.pitch);
    expect(r.stops[1].callback_window).toBe("weekdays after 5");
    expect(r.stops[1].walkMeters).toBeGreaterThan(0);
    expect(r.totalMeters).toBe(r.stops.reduce((m, s) => m + s.walkMeters, 0));
    expect(r.counts).toMatchObject({ candidates: HOUSES, taken: HOUSES, dnk: 0, recent: 0 });
    // Only the crew-safe fields: no score points, profit or labor cost.
    expect(Object.keys(first).sort()).toEqual(
      ["callback_window", "fullAddress", "id", "lat", "light", "lng", "order", "ownerFirstName", "pitch", "quoteLabel", "walkMeters"].sort(),
    );
    expect(r.season.service).toBe("leaf_cleanup");
    expect(r.pitches.map((p) => p.id)).toEqual(["p1"]);
  });

  it("takes walk_doors houses and skips do-not-knock, recently knocked and non-residential ones", async () => {
    const { db, houses } = walkSeed({ walk_doors: 3 });
    expect((await loadWalk(db, { ...start, now: THU_EVENING })).stops).toHaveLength(3);

    const t = db.tables;
    (t.parcels[0] as { do_not_knock: boolean }).do_not_knock = true;
    (t.parcels[1] as { land_use: string }).land_use = "400";
    t.knocks = [knockRow({ parcel_id: houses[2].id, knocked_at: "2026-10-28T21:00:00.000Z", outcome: "no_answer" })];
    const r = await loadWalk(db, { ...start, now: THU_EVENING });
    const ids = r.stops.map((s) => s.id);
    expect(ids).not.toContain(houses[0].id);
    expect(ids).not.toContain(houses[1].id);
    expect(ids).not.toContain(houses[2].id);
    expect(r.counts).toMatchObject({ dnk: 1, recent: 1, notResidential: 1, taken: 3 });
  });

  it("leaves red-light houses out and reports them", async () => {
    const { db } = walkSeed();
    // Saturday 10am: the block group's weekdays 4-6pm window is red for everyone.
    const r = await loadWalk(db, { ...start, now: SAT_MORNING });
    expect(r.stops).toEqual([]);
    expect(r.counts.badLight).toBe(HOUSES);
  });

  it("only walks houses within the radius and handles an empty area or a bad point", async () => {
    const { db, houses } = walkSeed();
    // 0.0003 deg of longitude is ~25 m: a 60 m radius from the first house reaches the first three.
    const near = await loadWalk(db, { ...start, radiusMeters: 60, now: THU_EVENING });
    expect(near.stops.map((s) => s.id)).toEqual(houses.slice(0, 3).map((h) => h.id));
    const far = await loadWalk(db, { lat: 40, lng: -80, now: THU_EVENING });
    expect(far.stops).toEqual([]);
    expect(far.pitches).toHaveLength(1);
    expect((await loadWalk(db, { lat: Number.NaN, lng: 0, now: THU_EVENING })).stops).toEqual([]);
  });
});
