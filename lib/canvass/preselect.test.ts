import { describe, expect, it } from "vitest";
import { followPick, needsRefetch, orderByDistance, preselectIndex, type FollowState, type PreselectParcel } from "./preselect";
import type { ParcelGeom } from "./types";

const square = (lng: number, lat: number, size = 0.0004): ParcelGeom => ({
  type: "Polygon",
  coordinates: [
    [
      [lng - size, lat - size],
      [lng + size, lat - size],
      [lng + size, lat + size],
      [lng - size, lat + size],
      [lng - size, lat - size],
    ],
  ],
});

const parcel = (id: string, lng: number, lat: number, geom: ParcelGeom | null = square(lng, lat)): PreselectParcel => ({
  id,
  centroid_lng: lng,
  centroid_lat: lat,
  geom,
});

describe("preselectIndex", () => {
  it("returns -1 for an empty list and 0 without a position", () => {
    expect(preselectIndex([], [-81.84, 41.47])).toBe(-1);
    expect(preselectIndex([parcel("a", -81.84, 41.47)], null)).toBe(0);
  });

  it("prefers the parcel whose polygon contains the point, even when another centroid is closer", () => {
    // "b" has a wide lot: the point is inside it but closer to a's centroid.
    const a = parcel("a", -81.8400, 41.4700, null);
    const b = parcel("b", -81.8420, 41.4700, square(-81.8420, 41.47, 0.003));
    const point: [number, number] = [-81.8402, 41.4700];
    expect(preselectIndex([a, b], point)).toBe(1);
  });

  it("falls back to the nearest centroid when no polygon contains the point", () => {
    const far = parcel("far", -81.85, 41.48);
    const near = parcel("near", -81.841, 41.471, null);
    expect(preselectIndex([far, near], [-81.8411, 41.4711])).toBe(1);
  });

  it("ignores degenerate geometry and parcels without a centroid", () => {
    const junk: PreselectParcel = { id: "junk", centroid_lat: null, centroid_lng: null, geom: { type: "Polygon", coordinates: [[]] } };
    const ok = parcel("ok", -81.84, 41.47, null);
    expect(preselectIndex([junk, ok], [-81.84, 41.47])).toBe(1);
  });
});

describe("orderByDistance", () => {
  it("sorts closest first and keeps order without a point", () => {
    const a = parcel("a", -81.85, 41.47);
    const b = parcel("b", -81.84, 41.47);
    expect(orderByDistance([a, b], [-81.84, 41.47]).map((p) => p.id)).toEqual(["b", "a"]);
    expect(orderByDistance([a, b], null).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("needsRefetch", () => {
  const within = (farthest: number) => Array.from({ length: 40 }, (_, i) => ({ meters: (farthest * (i + 1)) / 40 }));
  it("re-asks before the crew walks out of the loaded houses", () => {
    expect(needsRefetch(50, within(90))).toBe(false);
    expect(needsRefetch(55, within(90))).toBe(true); // 60% of 90 m
    expect(needsRefetch(100, within(250))).toBe(false);
    expect(needsRefetch(120, within(250))).toBe(true); // capped at 120 m
  });
  it("never re-asks on every fix, even with few or no houses loaded", () => {
    expect(needsRefetch(10, [])).toBe(false);
    expect(needsRefetch(30, [])).toBe(true);
    expect(needsRefetch(20, [{ meters: 5 }])).toBe(false);
  });
});

describe("followPick", () => {
  const at = (index: number): FollowState => ({ index, candidate: index, streak: 0 });
  it("ignores a neighbour that wins only alternating fixes", () => {
    let s = at(0);
    for (const c of [1, 0, 1, 0, 1, 0]) s = followPick(s, c);
    expect(s.index).toBe(0);
  });
  it("moves after the new house wins three fixes in a row", () => {
    let s = at(0);
    s = followPick(s, 1);
    s = followPick(s, 1);
    expect(s.index).toBe(0);
    s = followPick(s, 1);
    expect(s.index).toBe(1);
    expect(followPick(at(2), -1).index).toBe(2);
  });
});
