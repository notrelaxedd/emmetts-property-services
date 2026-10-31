/**
 * Walk Mode planner: the next N good doors, in walking order from where the crew is standing.
 * Pure: no next/* or db imports. Deterministic (ties fall back to distance, then id).
 *
 * Filter: not do-not-knock, not knocked within `recencyDays`, residential, has a location.
 * Rank:   score points (high first), then nearer to the start, then id; take `n`.
 * Route:  plan.ts routeOrder (nearest neighbour + 2-opt) from the start, then a small pass that keeps one side of
 *         the street together: when the next stop could equally be one of several houses within 15 m of the
 *         nearest, the one with the same house-number parity as the previous stop (same street) goes first.
 */
import { distanceMeters } from "./geometry";
import { routeOrder } from "./plan";
import type { Position } from "./types";

export const SAME_SIDE_TIE_METERS = 15;
/** How many stops ahead the same-side pass may pull a house forward from. */
const LOOKAHEAD = 4;
const DAY_MS = 86_400_000;

export type WalkParcel = {
  id: string;
  /** [lng, lat] (same as plan.ts); a house without one cannot be walked to and is left out. */
  centroid: Position | null;
  /** Simple-score points (0..9). */
  points: number;
  /** ISO timestamp of the last knock, if any. */
  lastKnockAt: string | null;
  do_not_knock: boolean;
  isResidential: boolean;
  street: string | null;
  houseNumber: number | null;
};

export type WalkStop<T extends WalkParcel = WalkParcel> = {
  /** parcels.id. */
  id: string;
  /** 1-based walking order. */
  order: number;
  lat: number;
  lng: number;
  /** Metres from the previous stop (the start for the first stop). */
  walkMeters: number;
  /** The house as it was passed in, so callers can carry extra fields through. */
  parcel: T;
};

export type WalkCounts = {
  candidates: number;
  dnk: number;
  recent: number;
  notResidential: number;
  noLocation: number;
  taken: number;
};

export type WalkInput<T extends WalkParcel = WalkParcel> = {
  parcels: readonly T[];
  start: { lat: number; lng: number };
  /** Number of doors to walk (the owner's `walk_doors`). */
  n: number;
  recencyDays: number;
  /** "Now" for the recency rule; defaults to the real clock. */
  now?: Date | string;
  /**
   * Houses already logged this session that the server may not have yet (still queued on the phone): left out like
   * a recent knock, before the top `n` are taken, so a re-plan still comes back with `n` doors.
   */
  exclude?: ReadonlySet<string>;
};

export type WalkResult<T extends WalkParcel = WalkParcel> = {
  stops: WalkStop<T>[];
  totalMeters: number;
  counts: WalkCounts;
};

const normStreet = (s: string | null) => (s ?? "").trim().toUpperCase();

/** Same street and both house numbers known. */
function sameStreet(a: WalkParcel, b: WalkParcel): boolean {
  return a.houseNumber !== null && b.houseNumber !== null && normStreet(a.street) !== "" && normStreet(a.street) === normStreet(b.street);
}

const sameParity = (a: WalkParcel, b: WalkParcel) => sameStreet(a, b) && (a.houseNumber as number) % 2 === (b.houseNumber as number) % 2;

/**
 * Walk the houses on one side of the street together where it costs almost nothing: at each step, if the
 * chosen next house is on the other side (parity differs on the same street) and a house on the previous stop's
 * side is among the next few and no more than 15 m farther from the previous stop, take that one first.
 */
function preferSameSide<T extends WalkParcel>(order: T[]): T[] {
  const out = order.slice();
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const here = out[i];
    if (!sameStreet(prev, here) || sameParity(prev, here)) continue;
    const prevPos = prev.centroid as Position;
    const limit = distanceMeters(prevPos, here.centroid as Position) + SAME_SIDE_TIE_METERS;
    const last = Math.min(out.length - 1, i + LOOKAHEAD);
    for (let j = i + 1; j <= last; j++) {
      const cand = out[j];
      if (sameParity(prev, cand) && distanceMeters(prevPos, cand.centroid as Position) <= limit) {
        out.splice(j, 1);
        out.splice(i, 0, cand);
        break;
      }
    }
  }
  return out;
}

export function buildWalk<T extends WalkParcel>(input: WalkInput<T>): WalkResult<T> {
  const nowMs = input.now === undefined ? Date.now() : new Date(input.now).getTime();
  const cutoff = nowMs - Math.max(0, input.recencyDays) * DAY_MS;
  const startPos: Position = [input.start.lng, input.start.lat];

  const counts: WalkCounts = { candidates: 0, dnk: 0, recent: 0, notResidential: 0, noLocation: 0, taken: 0 };
  const eligible: T[] = [];
  for (const p of input.parcels) {
    if (p.do_not_knock) {
      counts.dnk++;
      continue;
    }
    if (input.exclude?.has(p.id)) {
      counts.recent++;
      continue;
    }
    if (p.lastKnockAt) {
      const t = new Date(p.lastKnockAt).getTime();
      if (Number.isFinite(t) && t >= cutoff) {
        counts.recent++;
        continue;
      }
    }
    if (!p.isResidential) {
      counts.notResidential++;
      continue;
    }
    if (!p.centroid) {
      counts.noLocation++;
      continue;
    }
    eligible.push(p);
  }
  counts.candidates = eligible.length;

  const toStart = new Map<string, number>(eligible.map((p) => [p.id, distanceMeters(startPos, p.centroid as Position)]));
  const ranked = eligible.slice().sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const da = toStart.get(a.id) as number;
    const db = toStart.get(b.id) as number;
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const taken = ranked.slice(0, Math.max(0, Math.floor(input.n)));
  counts.taken = taken.length;
  if (taken.length === 0) return { stops: [], totalMeters: 0, counts };

  const order = routeOrder(
    taken.map((p) => p.centroid as Position),
    startPos,
    -1,
  );
  const walked = preferSameSide(order.map((i) => taken[i]));

  let totalMeters = 0;
  let here = startPos;
  const stops = walked.map((parcel, k): WalkStop<T> => {
    const pos = parcel.centroid as Position;
    const walkMeters = Math.round(distanceMeters(here, pos));
    totalMeters += walkMeters;
    here = pos;
    return { id: parcel.id, order: k + 1, lat: pos[1], lng: pos[0], walkMeters, parcel };
  });
  return { stops, totalMeters, counts };
}
