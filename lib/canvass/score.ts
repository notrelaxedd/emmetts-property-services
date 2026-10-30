/**
 * Priority score for a house: P(answer in the chosen slot) × P(convert) × expected job value × neighbor
 * boost. P(convert) starts flat and learns from our own knock log (lot band, owner-occupied, near a
 * customer, street, knocker, pitch) with Laplace smoothing so a street with two knocks cannot swing
 * the model. Pure: no next/* or db imports.
 */
import type { KnockOutcome } from "../db/types";
import { distanceMeters } from "./geometry";
import type { Position, QuoteRange, ScoreBreakdown } from "./types";

// ---------- Conversion model ----------

/** Nobody has converted anywhere yet: this is the day-one P(convert). */
export const FLAT_CONVERT_RATE = 0.08;
/** Laplace prior weight: every feature value starts as if it had k knocks at the base rate. */
export const LAPLACE_K = 5;
export const MIN_CONVERT = 0.01;
export const MAX_CONVERT = 0.6;

export type LotBand = "small" | "mid" | "large";

/** `< 6,000 sqft` small, `> 12,000 sqft` large, else mid; null when the lot is unknown. */
export function lotBand(lot_sqft: number | null | undefined): LotBand | null {
  if (lot_sqft === null || lot_sqft === undefined || !Number.isFinite(lot_sqft)) return null;
  if (lot_sqft < 6000) return "small";
  if (lot_sqft > 12000) return "large";
  return "mid";
}

/** A knock that produced a quote or a booking. */
export const isConvert = (outcome: KnockOutcome): boolean => outcome === "booked" || outcome === "quote_given";

export type ConvertFeatures = {
  lotBand: LotBand | null;
  ownerOccupied: boolean | null;
  nearCustomer: boolean | null;
  street: string | null;
  knockerId: string | null;
  pitchId: string | null;
};

export type ConvertRow = ConvertFeatures & { outcome: KnockOutcome };

export type FeatureCounts = { n: number; converts: number };

export const CONVERT_FEATURE_KEYS = ["lotBand", "ownerOccupied", "nearCustomer", "street", "knockerId", "pitchId"] as const;
export type ConvertFeatureKey = (typeof CONVERT_FEATURE_KEYS)[number];

export type ConvertModel = {
  /** Smoothed overall conversion rate. */
  base: number;
  /** Knocks the model was fitted on. */
  n: number;
  converts: number;
  k: number;
  /** Raw counts per feature → value (`"true"` / `"false"` for booleans, upper-cased streets). */
  features: Record<ConvertFeatureKey, Record<string, FeatureCounts>>;
};

const featureValue = (v: string | boolean | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = v.trim().toUpperCase();
  return s ? s : null;
};

export function emptyConvertModel(k = LAPLACE_K): ConvertModel {
  return {
    base: FLAT_CONVERT_RATE,
    n: 0,
    converts: 0,
    k,
    features: { lotBand: {}, ownerOccupied: {}, nearCustomer: {}, street: {}, knockerId: {}, pitchId: {} },
  };
}

/** Fit from the knock log joined to its parcels. An empty log gives the flat model. */
export function fitConvertModel(rows: readonly ConvertRow[], k = LAPLACE_K): ConvertModel {
  const model = emptyConvertModel(k);
  for (const row of rows) {
    const converted = isConvert(row.outcome);
    model.n++;
    if (converted) model.converts++;
    for (const key of CONVERT_FEATURE_KEYS) {
      const value = featureValue(row[key]);
      if (value === null) continue;
      const bucket = model.features[key];
      const counts = bucket[value] ?? (bucket[value] = { n: 0, converts: 0 });
      counts.n++;
      if (converted) counts.converts++;
    }
  }
  model.base = model.n > 0 ? (model.converts + k * FLAT_CONVERT_RATE) / (model.n + k) : FLAT_CONVERT_RATE;
  return model;
}

/** Smoothed conversion rate for one feature value: (converts + k·base) / (n + k). Unknown value → base. */
export function featureRate(model: ConvertModel, key: ConvertFeatureKey, value: string | boolean | null | undefined): number {
  const v = featureValue(value);
  const counts = v === null ? undefined : model.features[key][v];
  if (!counts) return model.base;
  return (counts.converts + model.k * model.base) / (counts.n + model.k);
}

const odds = (p: number) => p / (1 - p);

/**
 * Naive-Bayes-style combination: start from the base odds and multiply by each known feature's
 * likelihood ratio (its smoothed odds over the base odds), then clamp to 1–60 %. With no log at all
 * every rate equals the base, so the answer is the flat 8 %.
 */
export function convertProbability(features: Partial<ConvertFeatures>, model: ConvertModel): number {
  const base = Math.min(0.99, Math.max(0.001, model.base));
  let o = odds(base);
  for (const key of CONVERT_FEATURE_KEYS) {
    const rate = Math.min(0.99, Math.max(0.001, featureRate(model, key, features[key])));
    o *= odds(rate) / odds(base);
  }
  const p = o / (1 + o);
  return Math.min(MAX_CONVERT, Math.max(MIN_CONVERT, p));
}

// ---------- Neighbor boost ----------

export const NEAR_METERS = 60;
export const NEARBY_METERS = 150;
export const NEAR_BOOST = 1.5;
export const NEARBY_BOOST = 1.2;

/** Leading house number of "1234 Elm Rd" → 1234; null when the address does not start with one. */
export function houseNumber(address: string | null | undefined): number | null {
  const m = /^\s*(\d+)/.exec(address ?? "");
  return m ? Number(m[1]) : null;
}

/** "1234 Elm Rd Apt 2" → "ELM RD APT 2": the address with the leading house number (and a unit) stripped. */
export function streetOf(address: string | null | undefined): string {
  return (address ?? "")
    .replace(/^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export type NeighborParcel = {
  address: string;
  /** Upper-cased street name without the house number (parcels.street). */
  street: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
};

export type CustomerPoint = {
  address?: string | null;
  /** Optional; derived from the address when missing. */
  street?: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Houses between two numbers on the same side of the street (same parity). With the street's parcels
 * known it counts the real houses in between; otherwise house numbers are assumed to step by 2.
 */
export function houseDistance(a: number, b: number, parcelsOnStreet?: readonly { address: string }[]): number | null {
  if (a % 2 !== b % 2) return null; // opposite sides: the metres rule handles those
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === hi) return 0;
  if (!parcelsOnStreet || parcelsOnStreet.length === 0) return Math.ceil((hi - lo) / 2);
  const numbers = new Set<number>();
  for (const p of parcelsOnStreet) {
    const n = houseNumber(p.address);
    if (n !== null && n % 2 === lo % 2 && n > lo && n <= hi) numbers.add(n);
  }
  // Houses strictly between plus the far house itself; if the far house isn't a known parcel, count it anyway.
  return Math.max(1, numbers.size + (numbers.has(hi) ? 0 : 1));
}

/**
 * 1.5 when an existing customer is within `n` houses on the same street or within 60 m, 1.2 within
 * 150 m, else 1.0. `parcelsOnStreet` (the pulled parcels sharing the street) makes "within n houses"
 * count real houses instead of assuming numbers step by 2.
 */
export function neighborBoost(
  parcel: NeighborParcel,
  customers: readonly CustomerPoint[],
  n: number,
  parcelsOnStreet?: readonly { address: string }[],
): number {
  const here: Position | null =
    parcel.centroid_lat !== null && parcel.centroid_lng !== null ? [parcel.centroid_lng, parcel.centroid_lat] : null;
  const myNumber = houseNumber(parcel.address);
  const myStreet = parcel.street.trim().toUpperCase() || streetOf(parcel.address);
  let best = 1.0;
  for (const c of customers) {
    if (myNumber !== null && myStreet) {
      const theirStreet = (c.street?.trim().toUpperCase() || streetOf(c.address)) ?? "";
      const theirNumber = houseNumber(c.address);
      if (theirStreet && theirStreet === myStreet && theirNumber !== null) {
        const d = houseDistance(myNumber, theirNumber, parcelsOnStreet);
        if (d !== null && d <= n) return NEAR_BOOST;
      }
    }
    if (here && c.lat !== null && c.lng !== null) {
      const m = distanceMeters(here, [c.lng, c.lat]);
      if (m <= NEAR_METERS) return NEAR_BOOST;
      if (m <= NEARBY_METERS) best = Math.max(best, NEARBY_BOOST);
    }
  }
  return best;
}

// ---------- Priority score ----------

/** Expected job value in dollars: the quote mid (`quoteRange(...).mid`). */
export const expectedJobValue = (quote: Pick<QuoteRange, "mid">): number => Math.max(0, quote.mid);

export type PriorityInput = {
  /** P(answer) in the chosen slot (learned bucket mean or a prior guess). */
  pAnswer: number;
  pConvert: number;
  /** Expected job value in dollars (the quote mid). */
  value: number;
  neighborBoost: number;
};

export function priorityScore(input: PriorityInput): { score: number; breakdown: ScoreBreakdown } {
  const pAnswer = Math.min(1, Math.max(0, input.pAnswer));
  const pConvert = Math.min(1, Math.max(0, input.pConvert));
  const value = Math.max(0, input.value);
  const neighborBoost = Math.max(0, input.neighborBoost);
  const score = Math.round(pAnswer * pConvert * value * neighborBoost * 100) / 100;
  return { score, breakdown: { pAnswer, pConvert, value, neighborBoost } };
}

/**
 * Quintile (0 = bottom fifth … 4 = top fifth) of each score among the given scores, for map colouring.
 * Rank-based, so a skewed distribution still spreads over five colours; ties share the lower quintile.
 */
export function scoreQuintile(scores: readonly number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const sorted = scores.slice().sort((a, b) => a - b);
  return scores.map((s) => {
    // Number of scores strictly below s (binary search on the sorted copy).
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(4, Math.floor((lo * 5) / n));
  });
}
