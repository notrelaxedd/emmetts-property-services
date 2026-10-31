import { describe, expect, it } from "vitest";
import { distanceMeters } from "./geometry";
import { buildWalk, type WalkParcel } from "./walk";

const NOW = new Date("2026-10-28T14:00:00Z");
const START = { lat: 41.4, lng: -81.7 };
// 0.0001 deg lat ~ 11.1 m
const at = (dLat: number, dLng = 0): [number, number] => [START.lng + dLng, START.lat + dLat];

let seq = 0;
const house = (over: Partial<WalkParcel> = {}): WalkParcel => ({
  id: `p${++seq}`,
  centroid: at(0.001),
  points: 8,
  lastKnockAt: null,
  do_not_knock: false,
  isResidential: true,
  street: "ELM RD",
  houseNumber: 100,
  ...over,
});

const walk = (parcels: WalkParcel[], over: Partial<Parameters<typeof buildWalk>[0]> = {}) =>
  buildWalk({ parcels, start: START, n: 25, recencyDays: 14, now: NOW, ...over });

describe("buildWalk filtering", () => {
  it("drops do-not-knock, recent knocks, non-residential and houses without a location", () => {
    const keep = house({ id: "keep" });
    const r = walk([
      keep,
      house({ id: "dnk", do_not_knock: true }),
      house({ id: "recent", lastKnockAt: "2026-10-20T12:00:00Z" }),
      house({ id: "old", lastKnockAt: "2026-10-01T12:00:00Z", centroid: at(0.002) }),
      house({ id: "commercial", isResidential: false }),
      house({ id: "nowhere", centroid: null }),
    ]);
    expect(r.stops.map((s) => s.id).sort()).toEqual(["keep", "old"]);
    expect(r.counts).toEqual({ candidates: 2, dnk: 1, recent: 1, notResidential: 1, noLocation: 1, taken: 2 });
  });
  it("a knock exactly recencyDays ago is still recent; just older is allowed", () => {
    const edge = house({ id: "edge", lastKnockAt: new Date(NOW.getTime() - 14 * 86400000).toISOString() });
    const older = house({ id: "older", lastKnockAt: new Date(NOW.getTime() - 14 * 86400000 - 1000).toISOString(), centroid: at(0.002) });
    expect(walk([edge, older]).stops.map((s) => s.id)).toEqual(["older"]);
  });
  it("returns an empty walk with no eligible houses or n = 0", () => {
    expect(walk([])).toMatchObject({ stops: [], totalMeters: 0 });
    expect(walk([house()], { n: 0 }).stops).toEqual([]);
  });
});

describe("buildWalk exclude", () => {
  it("leaves out excluded houses before taking n, counting them as recent", () => {
    const hs = [house({ points: 9 }), house({ points: 8 }), house({ points: 7 }), house({ points: 6 })];
    const r = walk(hs, { n: 2, exclude: new Set([hs[0].id, hs[1].id]) });
    expect(r.stops.map((s) => s.id).sort()).toEqual([hs[2].id, hs[3].id].sort());
    expect(r.counts.recent).toBe(2);
    expect(r.counts.taken).toBe(2);
  });
});

describe("buildWalk ranking", () => {
  it("takes the top n by points, nearer first on a tie, then routes them", () => {
    const parcels = [
      house({ id: "low", points: 3, centroid: at(0.0005) }),
      house({ id: "hotY", points: 9, centroid: at(0.002) }),
      house({ id: "hotG", points: 9, centroid: at(0.003) }),
      house({ id: "mid", points: 6, centroid: at(0.004) }),
    ];
    const r = walk(parcels, { n: 3 });
    expect(r.stops.map((s) => s.id).sort()).toEqual(["hotG", "hotY", "mid"]);
    // n = 2 keeps the two 9s even though "low" is nearest to the start
    expect(walk(parcels, { n: 2 }).stops.map((s) => s.id).sort()).toEqual(["hotG", "hotY"]);
    // equal points: the house nearer to the start wins the last slot
    const tie = [house({ id: "far", points: 7, centroid: at(0.004) }), house({ id: "near", points: 7, centroid: at(0.0005) })];
    expect(walk(tie, { n: 1 }).stops.map((s) => s.id)).toEqual(["near"]);
  });
});

describe("buildWalk route", () => {
  it("walks nearest-first from the start, numbers stops from 1 and reports metres", () => {
    const parcels = [house({ id: "far", centroid: at(0.003) }), house({ id: "near", centroid: at(0.001) }), house({ id: "mid", centroid: at(0.002) })];
    const r = walk(parcels);
    expect(r.stops.map((s) => s.id)).toEqual(["near", "mid", "far"]);
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.stops[0].walkMeters).toBe(Math.round(distanceMeters([START.lng, START.lat], at(0.001))));
    expect(r.totalMeters).toBe(r.stops.reduce((m, s) => m + s.walkMeters, 0));
    expect(r.stops[0]).toMatchObject({ lat: START.lat + 0.001, lng: START.lng });
    expect(r.stops[0].parcel.id).toBe("near");
  });
  it("is deterministic and keeps extra fields on the parcel", () => {
    const parcels = [
      { ...house({ id: "a", centroid: at(0.001) }), fullAddress: "1 A St" },
      { ...house({ id: "b", centroid: at(0.002) }), fullAddress: "2 B St" },
    ];
    const one = buildWalk({ parcels, start: START, n: 25, recencyDays: 14, now: NOW });
    const two = buildWalk({ parcels: parcels.slice().reverse(), start: START, n: 25, recencyDays: 14, now: NOW });
    expect(one.stops.map((s) => s.id)).toEqual(two.stops.map((s) => s.id));
    expect(one.stops[0].parcel.fullAddress).toBe("1 A St");
  });
});

describe("buildWalk same side of the street", () => {
  // Evens on the north line (dLat 0.00005 ~ 5.5 m), odds across the road, all marching east.
  const east = (k: number, side: "even" | "odd") => at(side === "even" ? 0.0010 : 0.00105, 0.0001 * k);
  it("prefers the previous stop's parity when houses are within 15 m of each other", () => {
    const parcels = [
      house({ id: "100", houseNumber: 100, centroid: east(0, "even") }),
      house({ id: "101", houseNumber: 101, centroid: east(1.01, "odd") }), // opposite side, a touch nearer along the road
      house({ id: "102", houseNumber: 102, centroid: east(1.02, "even") }),
      house({ id: "103", houseNumber: 103, centroid: east(2.03, "odd") }),
      house({ id: "104", houseNumber: 104, centroid: east(2.04, "even") }),
    ];
    const ids = walk(parcels).stops.map((s) => s.id);
    // whatever the router picked, the same-side pass must not leave an avoidable zig-zag at the first split:
    const nums = ids.map(Number);
    let zigzags = 0;
    for (let i = 1; i < nums.length; i++) if (nums[i] % 2 !== nums[i - 1] % 2) zigzags++;
    expect(zigzags).toBeLessThanOrEqual(1);
  });

  it("pulls a same-side house ahead of an opposite-side one that is only slightly nearer", () => {
    const prev = house({ id: "a", houseNumber: 10, centroid: at(0.001, 0) });
    const opposite = house({ id: "b", houseNumber: 11, centroid: at(0.00105, 0.00010) }); // ~11 m
    const sameSide = house({ id: "c", houseNumber: 12, centroid: at(0.001, 0.00018) }); // ~15 m (within 15 m of "nearest")
    // route from a start next to `a`: a first, then the router picks b (nearer); the pass swaps in c
    const r = buildWalk({ parcels: [prev, opposite, sameSide], start: { lat: START.lat + 0.001, lng: START.lng - 0.00001 }, n: 3, recencyDays: 14, now: NOW });
    expect(r.stops.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("does not reorder when the same-side house is far out of the way or on another street", () => {
    const prev = house({ id: "a", houseNumber: 10, centroid: at(0.001, 0) });
    const opposite = house({ id: "b", houseNumber: 11, centroid: at(0.00105, 0.0001) });
    const farSame = house({ id: "c", houseNumber: 12, centroid: at(0.001, 0.0005) }); // ~42 m
    const otherStreet = house({ id: "d", houseNumber: 12, street: "OAK AVE", centroid: at(0.001, 0.00015) });
    const start = { lat: START.lat + 0.001, lng: START.lng - 0.00001 };
    const r1 = buildWalk({ parcels: [prev, opposite, farSame], start, n: 3, recencyDays: 14, now: NOW });
    expect(r1.stops.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const r2 = buildWalk({ parcels: [prev, opposite, otherStreet], start, n: 3, recencyDays: 14, now: NOW });
    expect(r2.stops.map((s) => s.id)).toEqual(["a", "b", "d"]);
  });
});
