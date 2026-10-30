import { describe, expect, it } from "vitest";
import { orderByDistance, preselectIndex, type PreselectParcel } from "./preselect";
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
