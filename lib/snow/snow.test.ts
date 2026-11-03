import { describe, expect, it } from "vitest";
import { monthCharge, seasonStart } from "./billing";
import { driveMinutes, mapsUrls, planSnowRoute } from "./route";
import type { SnowSettings } from "../db/types";

const base = { lat: 41.4756, lng: -81.8396 };
const stop = (id: string, lat: number | null, lng: number | null, minutes = 15) => ({ id, name: id, address: null, lat, lng, minutes });
const FINISH = new Date("2026-12-10T11:30:00.000Z"); // 6:30am ET

describe("planSnowRoute", () => {
  const stops = [stop("far", 41.5, -81.8), stop("near", 41.476, -81.84), stop("mid", 41.485, -81.83), stop("nowhere", null, null)];

  it("orders nearest-first, finishes exactly at the finish-by time, and skips stops with no location", () => {
    const plan = planSnowRoute({ base, stops, trucks: 1, mph: 20, finishBy: FINISH });
    expect(plan.unrouted.map((s) => s.id)).toEqual(["nowhere"]);
    const t = plan.trucks[0];
    expect(t.stops.map((s) => s.id)).toEqual(["near", "mid", "far"]);
    expect(t.finishAt.getTime()).toBe(FINISH.getTime());
    expect(t.startAt.getTime()).toBe(FINISH.getTime() - (t.driveMinutes + t.workMinutes) * 60_000);
    expect(t.stops[0].arriveAt.getTime()).toBe(t.startAt.getTime() + t.stops[0].driveMinutes * 60_000);
    expect(plan.startAt).toEqual(t.startAt);
  });

  it("splits across trucks so each starts later than one truck would", () => {
    const one = planSnowRoute({ base, stops, trucks: 1, mph: 20, finishBy: FINISH });
    const two = planSnowRoute({ base, stops, trucks: 2, mph: 20, finishBy: FINISH });
    expect(two.trucks).toHaveLength(2);
    expect(two.trucks.flatMap((t) => t.stops).length).toBe(3);
    expect(two.startAt!.getTime()).toBeGreaterThan(one.startAt!.getTime());
  });

  it("returns no trucks when nothing has a location", () => {
    expect(planSnowRoute({ base, stops: [stop("x", null, null)], trucks: 1, mph: 20, finishBy: FINISH })).toMatchObject({ trucks: [], startAt: null });
  });

  it("drive time and map links", () => {
    expect(driveMinutes(base, base, 20)).toBe(0);
    expect(driveMinutes(base, { lat: 41.5, lng: -81.8 }, 20)).toBeGreaterThan(5);
    const pts = Array.from({ length: 12 }, (_, i) => ({ lat: 41.4 + i / 100, lng: -81.8 }));
    const urls = mapsUrls(base, pts);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("waypoints=");
  });
});

describe("billing", () => {
  const s = { low_price: 60, medium_price: 100, high_price: 150, low_pushes: 4, medium_pushes: null, high_pushes: null, default_per_push: 35 } as SnowSettings;
  it("monthly plans charge the plan price and flag pushes over the included count", () => {
    expect(monthCharge({ plan: "low", per_push_price: null }, s, Array(6).fill({ price: null }))).toEqual({ amount: 60, over: 2 });
    expect(monthCharge({ plan: "medium", per_push_price: null }, s, Array(9).fill({ price: null }))).toEqual({ amount: 100, over: 0 });
  });
  it("per push adds up the price logged on each push", () => {
    expect(monthCharge({ plan: "per_push", per_push_price: 40 }, s, [{ price: 40 }, { price: 45 }, { price: null }])).toEqual({ amount: 125, over: 0 });
  });
  it("the season starts Sept 1", () => {
    expect(seasonStart("2026-12-10")).toBe("2026-09-01");
    expect(seasonStart("2027-02-01")).toBe("2026-09-01");
    expect(seasonStart("2026-09-02")).toBe("2026-09-01");
  });
});

describe("planSnowRoute forward (mowing)", () => {
  it("starts every truck at the start time and reports the latest finish", () => {
    const START = new Date("2026-06-10T12:00:00.000Z");
    const plan = planSnowRoute({ base, stops: [stop("a", 41.476, -81.84, 30), stop("b", 41.49, -81.82, 45)], trucks: 1, mph: 25, startAt: START });
    const t = plan.trucks[0];
    expect(t.startAt).toEqual(START);
    expect(plan.finishBy.getTime()).toBe(START.getTime() + (t.driveMinutes + t.workMinutes) * 60_000);
  });
});
