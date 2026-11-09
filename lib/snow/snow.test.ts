import { describe, expect, it } from "vitest";
import { monthCharge, planPriceLabel, seasonStart } from "./billing";
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
  const s = { default_per_push: 35 } as SnowSettings;
  it("adds up the price logged on each push, using the customer's price for pushes without one", () => {
    expect(monthCharge({ per_push_price: 40 }, s, [{ price: 40 }, { price: 45 }, { price: null }])).toEqual({ amount: 125 });
  });
  it("falls back to the default per-push price", () => {
    expect(monthCharge({ per_push_price: null }, s, [{ price: null }, { price: null }])).toEqual({ amount: 70 });
    expect(planPriceLabel({ per_push_price: null }, s)).toBe("$35/push");
    expect(planPriceLabel({ per_push_price: 42.5 }, s)).toBe("$42.50/push");
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
