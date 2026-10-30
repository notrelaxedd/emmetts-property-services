/**
 * Small GeoJSON helpers for the Canvass tab, all in WGS84 ([lng, lat]). Pure: no next/* or db imports.
 * Wraps the few @turf packages we depend on so the rest of lib/canvass has one place to look.
 */
import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import { point as turfPoint } from "@turf/helpers";
import type { GeoFeatureCollection, GeoPolygon, ParcelGeom, Position } from "./types";

export type Bbox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

const SQFT_PER_SQM = 10.7639;
const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** True when the point lies inside (or on the boundary of) the polygon / multipolygon. */
export function pointInPolygon(lngLat: Position, geom: ParcelGeom): boolean {
  try {
    return booleanPointInPolygon(turfPoint(lngLat), geom);
  } catch {
    // Degenerate rings (fewer than 4 positions) make turf throw; treat them as "not inside".
    return false;
  }
}

/** Geodesic area in square feet of a polygon, multipolygon or a FeatureCollection of them (sum). */
export function polygonAreaSqft(geom: ParcelGeom | GeoFeatureCollection | null | undefined): number {
  if (!geom) return 0;
  try {
    return area(geom) * SQFT_PER_SQM;
  } catch {
    return 0;
  }
}

/** Centroid of a polygon / multipolygon as [lng, lat]; null for a geometry turf cannot handle. */
export function centroidOf(geom: ParcelGeom | null | undefined): Position | null {
  if (!geom) return null;
  try {
    const c = centroid(geom).geometry.coordinates;
    const lng = c[0];
    const lat = c[1];
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  } catch {
    return null;
  }
}

/** Bounding box [minLng, minLat, maxLng, maxLat] of a polygon / multipolygon; null when it has no positions. */
export function bboxOf(geom: ParcelGeom | GeoPolygon): Bbox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const rings: Position[][] = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return Number.isFinite(minLng) ? [minLng, minLat, maxLng, maxLat] : null;
}

/** Great-circle distance in metres between two [lng, lat] positions (haversine). */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type HasCentroid = { centroid_lat: number | null; centroid_lng: number | null };

/** The parcel whose centroid is closest to the point, with the distance; null when none has a centroid. */
export function nearestByCentroid<T extends HasCentroid>(point: Position, parcels: T[]): { parcel: T; meters: number } | null {
  let best: { parcel: T; meters: number } | null = null;
  for (const parcel of parcels) {
    if (parcel.centroid_lat === null || parcel.centroid_lng === null) continue;
    const meters = distanceMeters(point, [parcel.centroid_lng, parcel.centroid_lat]);
    if (best === null || meters < best.meters) best = { parcel, meters };
  }
  return best;
}

/** Parcels sorted by centroid distance from the point (closest first); parcels without a centroid go last. */
export function sortByCentroidDistance<T extends HasCentroid>(point: Position, parcels: T[]): { parcel: T; meters: number }[] {
  return parcels
    .map((parcel) => ({
      parcel,
      meters:
        parcel.centroid_lat === null || parcel.centroid_lng === null
          ? Infinity
          : distanceMeters(point, [parcel.centroid_lng, parcel.centroid_lat]),
    }))
    .sort((a, b) => a.meters - b.meters);
}
