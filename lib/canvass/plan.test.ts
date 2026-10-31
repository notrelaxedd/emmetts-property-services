import { describe, expect, it } from "vitest";
import { doorsForHours, planSession, routeOrder } from "./plan";
import type { PlanParcel } from "./plan";
import type { Position } from "./types";

// Two hours of knocking.
const HOURS = 2;
const NOW = "2026-07-08T12:00:00Z";
const SETTINGS = { doors_per_hour: 25, recency_days: 14 };

/** A house on a small grid: column x (east), row y (north), ~30 m apart. */
function house(id: string, x: number, y: number, over: Partial<PlanParcel> = {}): PlanParcel {
  return {
    id,
    centroid: [-81.84 + x * 0.00036, 41.47 + y * 0.00027] as Position,
    score: 10,
    lastKnockAt: null,
    do_not_knock: false,
    ...over,
  };
}

describe("helpers", () => {
  it("sizes the session", () => {
    expect(doorsForHours(25, 2)).toBe(50);
    expect(doorsForHours(25, 0.5)).toBe(13);
    expect(doorsForHours(25, 0)).toBe(0);
    expect(doorsForHours(1, 0.25)).toBe(1);
  });
});

describe("planSession exclusions", () => {
  it("never includes do_not_knock houses, whatever their score", () => {
    const parcels = [house("a", 0, 0, { score: 100, do_not_knock: true }), house("b", 1, 0, { score: 1 }), house("c", 2, 0, { score: 50, do_not_knock: true })];
    const plan = planSession({ parcels, hours: HOURS, settings: SETTINGS, now: NOW });
    expect(plan.stops.map((s) => s.id)).toEqual(["b"]);
    expect(plan.counts).toEqual({ candidates: 1, dnk: 2, recent: 0, taken: 1 });
    expect(plan.excluded).toEqual({ dnk: 2, recent: 0 });
  });
  it("skips houses knocked within recency_days", () => {
    const parcels = [
      house("fresh", 0, 0, { lastKnockAt: "2026-07-01T20:00:00Z" }), // 7 days ago
      house("old", 1, 0, { lastKnockAt: "2026-06-01T20:00:00Z" }), // 37 days ago
      house("never", 2, 0),
      house("edge", 3, 0, { lastKnockAt: "2026-06-24T12:00:00Z" }), // exactly 14 days
    ];
    const plan = planSession({ parcels, hours: HOURS, settings: SETTINGS, now: NOW });
    expect(plan.stops.map((s) => s.id).sort()).toEqual(["never", "old"]);
    expect(plan.counts.recent).toBe(2);
    const relaxed = planSession({ parcels, hours: HOURS, settings: { ...SETTINGS, recency_days: 3 }, now: NOW });
    expect(relaxed.counts.recent).toBe(0);
  });
  it("takes the top doors_per_hour × hours by score", () => {
    const parcels = Array.from({ length: 12 }, (_, i) => house(`h${i}`, i % 4, Math.floor(i / 4), { score: i }));
    const plan = planSession({ parcels, hours: 0.5, settings: { doors_per_hour: 10, recency_days: 14 }, now: NOW });
    expect(plan.counts.taken).toBe(5);
    expect(plan.stops.map((s) => s.id).sort()).toEqual(["h10", "h11", "h7", "h8", "h9"]);
    expect(plan.stops.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("planSession routing", () => {
  // A 2 x 4 grid (two sides of one street). Scores favour the far east end.
  const GRID = [
    house("w0", 0, 0, { score: 1 }),
    house("w1", 1, 0, { score: 2 }),
    house("w2", 2, 0, { score: 3 }),
    house("w3", 3, 0, { score: 9 }),
    house("n0", 0, 1, { score: 1 }),
    house("n1", 1, 1, { score: 2 }),
    house("n2", 2, 1, { score: 3 }),
    house("n3", 3, 1, { score: 8 }),
  ];

  it("starts at the best house and walks a short path when no start point is given", () => {
    const plan = planSession({ parcels: GRID, hours: HOURS, settings: SETTINGS, now: NOW });
    expect(plan.stops).toHaveLength(8);
    expect(plan.stops[0]).toEqual({ id: "w3", parcel: GRID[3], order: 1, walkMeters: 0 });
    // Every step is to a neighbouring house (≤ ~45 m, a diagonal), never a long jump.
    for (const s of plan.stops.slice(1)) expect(s.walkMeters).toBeLessThanOrEqual(45);
    expect(plan.totalMeters).toBe(plan.stops.reduce((sum, s) => sum + s.walkMeters, 0));
    // Optimal walk over a 2x4 grid with 30 m spacing is 7 edges of ~30 m.
    expect(plan.totalMeters).toBeLessThan(7 * 31 + 20);
  });

  it("starts from the given start point and is deterministic", () => {
    const start: Position = [-81.84 - 0.00036, 41.47]; // just west of w0
    const a = planSession({ parcels: GRID, hours: HOURS, settings: SETTINGS, startPoint: start, now: NOW });
    const b = planSession({ parcels: GRID.slice().reverse(), hours: HOURS, settings: SETTINGS, startPoint: start, now: NOW });
    expect(a.stops[0].id).toBe("w0");
    expect(a.stops[0].walkMeters).toBeGreaterThan(20);
    expect(a.stops.map((s) => s.id)).toEqual(b.stops.map((s) => s.id));
    expect(a.stops.map((s) => s.id).sort()).toEqual(GRID.map((h) => h.id).sort());
    for (const s of a.stops.slice(1)) expect(s.walkMeters).toBeLessThanOrEqual(45);
  });

  it("puts houses without a centroid last", () => {
    const parcels = [house("a", 0, 0, { score: 1 }), house("b", 1, 0, { score: 5 }), house("nowhere", 9, 9, { score: 99, centroid: null })];
    const plan = planSession({ parcels, hours: HOURS, settings: SETTINGS, now: NOW });
    expect(plan.stops.map((s) => s.id)).toEqual(["b", "a", "nowhere"]);
    expect(plan.stops[2]).toEqual({ id: "nowhere", parcel: parcels[2], order: 3, walkMeters: 0 });
  });

  it("returns an empty plan for an zero hours or no houses", () => {
    expect(planSession({ parcels: [], hours: HOURS, settings: SETTINGS, now: NOW })).toEqual({
      stops: [],
      totalMeters: 0,
      excluded: { dnk: 0, recent: 0 },
      counts: { candidates: 0, dnk: 0, recent: 0, taken: 0 },
    });
    const none = planSession({ parcels: GRID, hours: 0, settings: SETTINGS, now: NOW });
    expect(none.stops).toEqual([]);
    expect(none.counts.candidates).toBe(8);
    expect(none.counts.taken).toBe(0);
  });
});

describe("routeOrder", () => {
  it("2-opt untangles a crossing", () => {
    // Four corners of a ~30 m square; nearest-neighbour from an external start could zig-zag.
    const pts: Position[] = [
      [-81.84, 41.47],
      [-81.84 + 0.00036, 41.47 + 0.00027],
      [-81.84 + 0.00036, 41.47],
      [-81.84, 41.47 + 0.00027],
    ];
    const order = routeOrder(pts, null, 0);
    expect(order[0]).toBe(0);
    expect(order.slice().sort()).toEqual([0, 1, 2, 3]);
    // Walking the corners in order never takes a diagonal.
    const walk = (o: number[]) => o.slice(1).reduce((sum, idx, i) => sum + Math.hypot(pts[idx][0] - pts[o[i]][0], pts[idx][1] - pts[o[i]][1]), 0);
    expect(walk(order)).toBeCloseTo(0.00036 * 2 + 0.00027, 6);
    expect(routeOrder([], null, 0)).toEqual([]);
  });
});
