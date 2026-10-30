/**
 * Which house the crew member is standing at: the parcel whose polygon contains the GPS point,
 * else the nearest centroid. Pure; shared by the knock logger (client) and its tests.
 */
import { pointInPolygon, sortByCentroidDistance, type HasCentroid } from "./geometry";
import type { ParcelGeom, Position } from "./types";

export type PreselectParcel = HasCentroid & { id: string; geom: ParcelGeom | null };

/** Index of the parcel to pre-select, or -1 when the list is empty. */
export function preselectIndex<T extends PreselectParcel>(parcels: readonly T[], lngLat: Position | null): number {
  if (parcels.length === 0) return -1;
  if (!lngLat) return 0;
  const inside = parcels.findIndex((p) => p.geom !== null && pointInPolygon(lngLat, p.geom));
  if (inside >= 0) return inside;
  const nearest = sortByCentroidDistance(lngLat, [...parcels])[0];
  if (!nearest || !Number.isFinite(nearest.meters)) return 0;
  return parcels.findIndex((p) => p.id === nearest.parcel.id);
}

/** Parcels in walking order from the point (closest first). */
export function orderByDistance<T extends HasCentroid>(parcels: readonly T[], lngLat: Position | null): T[] {
  if (!lngLat) return [...parcels];
  return sortByCentroidDistance(lngLat, [...parcels]).map((s) => s.parcel);
}
