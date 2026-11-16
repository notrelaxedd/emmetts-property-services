import { describe, expect, it } from "vitest";
import { haversineMiles } from "../geo/distance";
import { planDayRoute } from "./day";
import { startSlots, withStart } from "./starts";

const start = { lat: 41.47, lng: -81.84 };
const at = (id: string, dLat: number, dLng: number) => ({ id, lat: start.lat + dLat, lng: start.lng + dLng });
const length = (from: { lat: number; lng: number }, order: { lat: number; lng: number }[]) => {
  let total = 0;
  let p = from;
  for (const s of order) {
    total += haversineMiles(p, s);
    p = s;
  }
  return total;
};

describe("planDayRoute", () => {
  it("is empty with no houses", () => {
    expect(planDayRoute(start, [])).toEqual({ stops: [], driveMinutes: 0, miles: 0, mapsUrls: [] });
  });

  it("visits houses along a line in order, whatever order they came in", () => {
    const r = planDayRoute(start, [at("c", 0.03, 0), at("a", 0.01, 0), at("b", 0.02, 0)]);
    expect(r.stops.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.miles).toBeGreaterThan(0);
    expect(r.driveMinutes).toBe(r.stops.reduce((a, s) => a + s.driveMinutes, 0));
    expect(r.mapsUrls).toHaveLength(1);
  });

  it("beats nearest-neighbour when the nearest house is the wrong first stop", () => {
    // Nearest-first heads east, on to far-east, then all the way back west. West first is shorter overall.
    const stops = [at("east", 0, 0.01), at("west", 0, -0.011), at("far-east", 0, 0.03)];
    const r = planDayRoute(start, stops);
    expect(r.stops.map((s) => s.id)).toEqual(["west", "east", "far-east"]);
  });

  it("is never longer than the order given, for small and large sets", () => {
    for (const n of [5, 9, 14]) {
      const stops = Array.from({ length: n }, (_, i) => at(`s${i}`, Math.sin(i * 2.3) * 0.03, Math.cos(i * 1.7) * 0.04));
      const r = planDayRoute(start, stops);
      expect(r.stops.map((s) => s.id).sort()).toEqual(stops.map((s) => s.id).sort());
      expect(length(start, r.stops)).toBeLessThanOrEqual(length(start, stops) + 1e-9);
    }
  });

  it("splits Google Maps links at 10 stops", () => {
    const stops = Array.from({ length: 12 }, (_, i) => at(`s${i}`, 0.001 * (i + 1), 0));
    expect(planDayRoute(start, stops).mapsUrls).toHaveLength(2);
  });
});

describe("start slots", () => {
  it("always returns the three slots, empty when nothing is stored", () => {
    for (const stored of [undefined, null, [], "x", [{ key: "nope" }]]) {
      expect(startSlots(stored).map((s) => [s.key, s.lat])).toEqual([["school", null], ["home", null], ["emmett", null]]);
    }
  });

  it("fills a slot and ignores half a coordinate", () => {
    const slots = startSlots([{ key: "home", address: " 1 Main St ", lat: 41.4, lng: -81.8 }, { key: "school", address: "x", lat: 41.4, lng: null }]);
    expect(slots[1]).toEqual({ key: "home", label: "My house", address: "1 Main St", lat: 41.4, lng: -81.8 });
    expect(slots[0].lat).toBeNull();
  });

  it("replaces one slot and keeps the others", () => {
    const stored = [{ key: "home", address: "1 Main St", lat: 41.4, lng: -81.8 }, { key: "emmett", address: "2 Oak", lat: 41.5, lng: -81.9 }];
    const next = withStart(stored, { key: "home", address: "9 Elm", lat: 41.6, lng: -81.7 });
    expect(next).toHaveLength(2);
    expect(next.find((s) => s.key === "home")?.address).toBe("9 Elm");
    expect(next.find((s) => s.key === "emmett")?.address).toBe("2 Oak");
  });
});
