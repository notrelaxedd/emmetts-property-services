/**
 * "Plan my session": the highest-scoring houses, as many as the crew can knock in the hours given
 * (doors_per_hour x hours), in a sensible walking order. Deterministic (no randomness) so the same inputs give
 * the same plan. Pure: no next/* or db imports.
 */
import { distanceMeters } from "./geometry";
import type { Position } from "./types";

export type PlanParcel = {
  id: string;
  /** [lng, lat]; a house without one is kept but cannot be routed (it goes last with walkMeters 0). */
  centroid: Position | null;
  score: number;
  /** ISO timestamp of the last knock, if any. */
  lastKnockAt: string | null;
  do_not_knock: boolean;
  street?: string | null;
};

export type PlanSettings = { doors_per_hour: number; recency_days: number };

export type PlanInput = {
  parcels: readonly PlanParcel[];
  /** How many hours the crew will knock; doors = doors_per_hour x hours. */
  hours: number;
  settings: PlanSettings;
  /** Where the crew starts walking ([lng, lat]); defaults to the best-scoring house. */
  startPoint?: Position | null;
  /** "Now" for the recency rule; defaults to the real clock. */
  now?: Date | string;
};

export type PlanStop = {
  /** parcels.id (= `parcel.id`). */
  id: string;
  /** The planned house as it was passed in (score, street …). */
  parcel: PlanParcel;
  /** 1-based walking order. */
  order: number;
  /** Metres from the previous stop (or the start point); 0 for the first stop without a start point. */
  walkMeters: number;
};

export type PlanExcluded = { dnk: number; recent: number };

export type PlanResult = {
  stops: PlanStop[];
  totalMeters: number;
  /** Why houses were left out (do-not-knock, knocked within recency_days). */
  excluded: PlanExcluded;
  counts: PlanExcluded & {
    /** Houses still eligible after the exclusions (what competed for a place in the plan). */
    candidates: number;
    dnk: number;
    recent: number;
    taken: number;
  };
};

const DAY_MS = 86_400_000;

/** Houses to knock in a session: round(doors per hour × hours), never below 1 for a positive number of hours. */
export function doorsForHours(doorsPerHour: number, hours: number): number {
  if (!(hours > 0)) return 0;
  return Math.max(1, Math.round(doorsPerHour * hours));
}

const dist = (a: Position, b: Position) => distanceMeters(a, b);

/**
 * Nearest-neighbour order starting from `start` (an index into `points`, or -1 for an external start
 * point), then 2-opt until no segment reversal shortens the walk. The route is an open path: the crew
 * does not walk back to the start.
 */
export function routeOrder(points: readonly Position[], startPoint: Position | null, startIndex: number): number[] {
  const n = points.length;
  if (n === 0) return [];
  const remaining = new Set<number>(points.map((_, i) => i));
  const order: number[] = [];
  let here: Position;
  if (startPoint) {
    here = startPoint;
  } else {
    order.push(startIndex);
    remaining.delete(startIndex);
    here = points[startIndex];
  }
  while (remaining.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const i of Array.from(remaining)) {
      const d = dist(here, points[i]);
      if (d < bestD || (d === bestD && i < best)) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    remaining.delete(best);
    here = points[best];
  }

  // 2-opt on the open path. The first stop is fixed when the route starts at a house (it's the
  // anchor); with an external start point every stop may move, but the walk from the start counts.
  const fixedFirst = !startPoint;
  const posOf = (k: number): Position => (k < 0 ? (startPoint as Position) : points[order[k]]);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 1000) {
    improved = false;
    const first = fixedFirst ? 1 : 0;
    for (let i = first; i < n - 1; i++) {
      const prev = i === 0 ? (startPoint ? -1 : null) : i - 1;
      for (let k = i + 1; k < n; k++) {
        // Reverse order[i..k]. Edges touched: (prev → i) and (k → k+1).
        const before = (prev === null ? 0 : dist(posOf(prev), posOf(i))) + (k + 1 < n ? dist(posOf(k), posOf(k + 1)) : 0);
        const after = (prev === null ? 0 : dist(posOf(prev), posOf(k))) + (k + 1 < n ? dist(posOf(i), posOf(k + 1)) : 0);
        if (after < before - 1e-6) {
          let a = i;
          let b = k;
          while (a < b) {
            const t = order[a];
            order[a] = order[b];
            order[b] = t;
            a++;
            b--;
          }
          improved = true;
        }
      }
    }
  }
  return order;
}

/**
 * Exclude do-not-knock houses and houses knocked within `recency_days`; keep the top `doors_per_hour × hours` by score; walk them nearest-neighbour + 2-opt
 * from `startPoint` (or from the best house). Deterministic.
 */
export function planSession(input: PlanInput): PlanResult {
  const { parcels, settings } = input;
  const nowMs = input.now === undefined ? Date.now() : new Date(input.now).getTime();
  const recencyCutoff = nowMs - Math.max(0, settings.recency_days) * DAY_MS;

  const counts = { candidates: 0, dnk: 0, recent: 0, taken: 0 };
  const eligible: PlanParcel[] = [];
  for (const p of parcels) {
    if (p.do_not_knock) {
      counts.dnk++;
      continue;
    }
    if (p.lastKnockAt) {
      const t = new Date(p.lastKnockAt).getTime();
      if (Number.isFinite(t) && t >= recencyCutoff) {
        counts.recent++;
        continue;
      }
    }
    eligible.push(p);
  }
  counts.candidates = eligible.length;

  const doors = doorsForHours(settings.doors_per_hour, input.hours);
  const chosen = eligible
    .slice()
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, doors);
  counts.taken = chosen.length;

  const routable = chosen.filter((p) => p.centroid !== null);
  const unroutable = chosen.filter((p) => p.centroid === null);
  const points = routable.map((p) => p.centroid as Position);
  const startPoint = input.startPoint ?? null;
  const order = routeOrder(points, startPoint, 0); // index 0 = the best-scoring routable house

  const stops: PlanStop[] = [];
  let totalMeters = 0;
  let here: Position | null = startPoint;
  for (const idx of order) {
    const p = routable[idx];
    const point = points[idx];
    const walkMeters = here ? Math.round(dist(here, point)) : 0;
    totalMeters += walkMeters;
    stops.push({ id: p.id, parcel: p, order: stops.length + 1, walkMeters });
    here = point;
  }
  for (const p of unroutable) stops.push({ id: p.id, parcel: p, order: stops.length + 1, walkMeters: 0 });

  const excluded: PlanExcluded = { dnk: counts.dnk, recent: counts.recent };
  return { stops, totalMeters, excluded, counts };
}
