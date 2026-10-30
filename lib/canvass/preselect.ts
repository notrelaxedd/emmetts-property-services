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

/** Furthest the logger walks from its last query point before asking the server again, in metres. */
export const MAX_REFETCH_METERS = 120;
/** Nearest it re-asks (so a short list near the 250 m edge does not re-query on every fix). */
export const MIN_REFETCH_METERS = 30;

/**
 * True once the crew member has walked far enough from the last query point that the loaded houses may no longer
 * include the one they stand at: past 60% of the way to the farthest loaded house (40 houses on a residential
 * grid cover only ~90 m), and never later than `MAX_REFETCH_METERS`.
 */
export function needsRefetch(movedMeters: number, parcels: readonly { meters: number }[]): boolean {
  let farthest = 0;
  for (const p of parcels) if (Number.isFinite(p.meters)) farthest = Math.max(farthest, p.meters);
  const limit = Math.min(MAX_REFETCH_METERS, Math.max(MIN_REFETCH_METERS, farthest * 0.6));
  return movedMeters >= limit;
}

/** GPS follow state: the selected index, plus the challenger and how many fixes in a row it has won. */
export type FollowState = { index: number; candidate: number; streak: number };

/** Fixes in a row a neighbouring house must win before the selection moves to it. */
export const FOLLOW_CONFIRM_FIXES = 3;

/**
 * Hysteresis for following the GPS: a new house is selected only after it wins `confirm` consecutive fixes, so
 * 5–10 m of GPS noise on a lot line does not flip the selection (and the house a tap logs) between neighbours.
 */
export function followPick(state: FollowState, candidate: number, confirm = FOLLOW_CONFIRM_FIXES): FollowState {
  if (candidate < 0 || candidate === state.index) return { index: state.index, candidate: state.index, streak: 0 };
  const streak = candidate === state.candidate ? state.streak + 1 : 1;
  return streak >= confirm ? { index: candidate, candidate, streak: 0 } : { index: state.index, candidate, streak };
}
