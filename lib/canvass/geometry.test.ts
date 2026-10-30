import { describe, expect, it } from "vitest";
import {
  bboxOf,
  centroidOf,
  distanceMeters,
  nearestByCentroid,
  pointInPolygon,
  polygonAreaSqft,
  sortByCentroidDistance,
} from "./geometry";
import type { GeoMultiPolygon, GeoPolygon } from "./types";

// A roughly 60 ft x 120 ft lot in Rocky River (0.00018 deg lng ~ 15 m at 41.5N, 0.00033 deg lat ~ 37 m).
const LOT: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [-81.8396, 41.4756],
      [-81.8394, 41.4756],
      [-81.8394, 41.4759],
      [-81.8396, 41.4759],
      [-81.8396, 41.4756],
    ],
  ],
};

const MULTI: GeoMultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    LOT.coordinates,
    [
      [
        [-81.83, 41.47],
        [-81.829, 41.47],
        [-81.829, 41.471],
        [-81.83, 41.471],
        [-81.83, 41.47],
      ],
    ],
  ],
};

describe("pointInPolygon", () => {
  it("is true inside, false outside, and handles multipolygons", () => {
    expect(pointInPolygon([-81.8395, 41.47575], LOT)).toBe(true);
    expect(pointInPolygon([-81.84, 41.47575], LOT)).toBe(false);
    expect(pointInPolygon([-81.8295, 41.4705], MULTI)).toBe(true);
    expect(pointInPolygon([-81.8395, 41.47575], MULTI)).toBe(true);
  });
  it("does not throw on a degenerate ring", () => {
    const bad: GeoPolygon = { type: "Polygon", coordinates: [[[-81.8, 41.4]]] };
    expect(pointInPolygon([-81.8, 41.4], bad)).toBe(false);
  });
});

describe("polygonAreaSqft", () => {
  it("is about 16.7 m x 33.3 m for the test lot", () => {
    const sqft = polygonAreaSqft(LOT);
    // 0.0002 deg lng at 41.4757N ~ 16.68 m; 0.0003 deg lat ~ 33.3 m -> ~556 m2 -> ~5,980 sqft.
    expect(sqft).toBeGreaterThan(5500);
    expect(sqft).toBeLessThan(6500);
  });
  it("sums a FeatureCollection of traced lawn polygons", () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, geometry: LOT, properties: null },
        { type: "Feature" as const, geometry: LOT, properties: null },
      ],
    };
    expect(polygonAreaSqft(fc)).toBeCloseTo(polygonAreaSqft(LOT) * 2, 6);
  });
  it("is 0 for null", () => {
    expect(polygonAreaSqft(null)).toBe(0);
  });
});

describe("centroidOf / bboxOf", () => {
  it("centroid of the lot is its middle", () => {
    const c = centroidOf(LOT);
    expect(c).not.toBeNull();
    expect(c![0]).toBeCloseTo(-81.8395, 5);
    expect(c![1]).toBeCloseTo(41.47575, 5);
    expect(centroidOf(null)).toBeNull();
  });
  it("bbox covers every ring of a multipolygon", () => {
    expect(bboxOf(LOT)).toEqual([-81.8396, 41.4756, -81.8394, 41.4759]);
    expect(bboxOf(MULTI)).toEqual([-81.8396, 41.47, -81.829, 41.4759]);
    expect(bboxOf({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("distanceMeters", () => {
  it("Rocky River to Public Square is about 12.5 km", () => {
    const d = distanceMeters([-81.8396, 41.4756], [-81.6944, 41.4993]);
    expect(d).toBeGreaterThan(12_000);
    expect(d).toBeLessThan(13_000);
  });
  it("is zero for the same point", () => {
    expect(distanceMeters([-81.8396, 41.4756], [-81.8396, 41.4756])).toBe(0);
  });
});

describe("nearestByCentroid", () => {
  const parcels = [
    { id: "a", centroid_lat: 41.4756, centroid_lng: -81.8396 },
    { id: "b", centroid_lat: 41.4760, centroid_lng: -81.8396 },
    { id: "c", centroid_lat: null, centroid_lng: null },
  ];
  it("picks the closest parcel with a centroid", () => {
    const hit = nearestByCentroid([-81.8396, 41.4759], parcels);
    expect(hit?.parcel.id).toBe("b");
    expect(hit?.meters).toBeLessThan(15);
  });
  it("returns null when nothing has a centroid", () => {
    expect(nearestByCentroid([-81.8396, 41.4759], [parcels[2]])).toBeNull();
  });
  it("sorts by distance with centroid-less parcels last", () => {
    expect(sortByCentroidDistance([-81.8396, 41.4759], parcels).map((p) => p.parcel.id)).toEqual(["b", "a", "c"]);
  });
});
