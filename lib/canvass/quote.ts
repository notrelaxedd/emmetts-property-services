/**
 * Door quotes for the Canvass tab. Pure: no next/* or db imports.
 *
 * Turf comes from the county estimate (lot − building footprint − a hardscape share) unless the crew traced the
 * lawn on the satellite map, in which case the traced area wins. Every quote is a low/high RANGE built from the
 * settings row: base price per service + a rate per 1,000 sqft of turf, floored at the minimum charge, and (only when
 * the owner turns it on) nudged up by a value tier that the code caps at ×1.10 whatever the settings say.
 */
import area from "@turf/area";
import type { CanvassSettings, Parcel } from "../db/types";
import { SERVICE_KEYS, SERVICE_LABELS } from "./types";
import type { GeoFeatureCollection, ParcelGeom, QuoteRange, ServiceKey } from "./types";

export { seasonService } from "./season";

export const SQFT_PER_SQM = 10.7639;

/** The value tier can never add more than 10%, even if the settings row says otherwise. */
export const VALUE_TIER_CAP = 1.1;
/** Market value at which the full value-tier multiplier applies. */
export const VALUE_TIER_FULL_AT = 400_000;
/** Market value at which half of the value-tier multiplier applies. */
export const VALUE_TIER_HALF_AT = 250_000;

export const LOW_FACTOR = 0.9;
export const HIGH_FACTOR = 1.15;

export type TurfInput = Pick<Parcel, "lot_sqft" | "footprint_sqft" | "living_sqft" | "stories">;
export type TurfParcel = Pick<Parcel, "turf_sqft_traced" | "turf_sqft_est">;
export type QuoteSettings = Pick<
  CanvassSettings,
  "base_prices" | "rate_per_1000_sqft" | "min_charge" | "value_tier_enabled" | "value_tier_max"
>;

export type TurfSource = "traced" | "estimate";

export type QuoteInput = {
  /** Effective turf in sqft; null when the lot is unknown (the base price alone is quoted). */
  turf_sqft: number | null;
  market_value: number | null;
  service: ServiceKey;
  /** Where the turf number came from; only used in `basis`. */
  turf_source?: TurfSource | null;
};

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const round5 = (n: number): number => Math.round(n / 5) * 5;

const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sqft`;
const dollars = (n: number) => `$${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2)}`;

/**
 * Building footprint in sqft: the county's footprint field when present, else living area spread over the
 * stories (one storey when unknown); 0 when the county gave neither.
 */
export function footprintSqft(parcel: Pick<TurfInput, "footprint_sqft" | "living_sqft" | "stories">): number {
  if (finite(parcel.footprint_sqft) && parcel.footprint_sqft > 0) return parcel.footprint_sqft;
  if (finite(parcel.living_sqft) && parcel.living_sqft > 0) {
    const stories = finite(parcel.stories) && parcel.stories > 0 ? parcel.stories : 1;
    return parcel.living_sqft / Math.max(1, stories);
  }
  return 0;
}

/**
 * County estimate of the turf: `lot − footprint − lot × hardscape_pct`, never negative, whole sqft. Null when the
 * lot size is unknown.
 */
export function estimateTurf(parcel: TurfInput, hardscape_pct: number): number | null {
  if (!finite(parcel.lot_sqft) || parcel.lot_sqft < 0) return null;
  const hardscape = finite(hardscape_pct) ? clamp(hardscape_pct, 0, 1) : 0;
  const lot = parcel.lot_sqft;
  return Math.round(Math.max(0, lot - footprintSqft(parcel) - lot * hardscape));
}

/** Traced turf wins over the estimate; null when neither is known. */
export function effectiveTurf(parcel: TurfParcel): number | null {
  if (finite(parcel.turf_sqft_traced) && parcel.turf_sqft_traced >= 0) return parcel.turf_sqft_traced;
  if (finite(parcel.turf_sqft_est) && parcel.turf_sqft_est >= 0) return parcel.turf_sqft_est;
  return null;
}

/** Which number `effectiveTurf` used; null when neither is known. */
export function turfSource(parcel: TurfParcel): TurfSource | null {
  if (finite(parcel.turf_sqft_traced) && parcel.turf_sqft_traced >= 0) return "traced";
  if (finite(parcel.turf_sqft_est) && parcel.turf_sqft_est >= 0) return "estimate";
  return null;
}

/**
 * The value-tier multiplier for a house: 1 when the tier is off or the value is unknown; otherwise
 * 1 + (max − 1) × tier where tier is 1 at ≥ $400k, ½ at ≥ $250k, 0 below. `value_tier_max` is clamped to
 * 1.0–1.10 here, so a bad settings value can never inflate a quote.
 */
export function valueTierMultiplier(
  market_value: number | null | undefined,
  settings: Pick<QuoteSettings, "value_tier_enabled" | "value_tier_max">,
): number {
  if (!settings.value_tier_enabled || !finite(market_value)) return 1;
  const max = clamp(finite(settings.value_tier_max) ? settings.value_tier_max : 1, 1, VALUE_TIER_CAP);
  const tier = market_value >= VALUE_TIER_FULL_AT ? 1 : market_value >= VALUE_TIER_HALF_AT ? 0.5 : 0;
  return Math.round((1 + (max - 1) * tier) * 1000) / 1000;
}

/** Low / high / mid dollars for one service, with a one-line `basis` for hover. */
export function quoteRange(input: QuoteInput, settings: QuoteSettings): QuoteRange {
  const service = input.service;
  const base = finite(settings.base_prices?.[service]) ? Math.max(0, settings.base_prices[service]) : 0;
  const rate = finite(settings.rate_per_1000_sqft) ? Math.max(0, settings.rate_per_1000_sqft) : 0;
  const minCharge = finite(settings.min_charge) ? Math.max(0, settings.min_charge) : 0;
  const turf = finite(input.turf_sqft) && input.turf_sqft >= 0 ? input.turf_sqft : null;

  const parts: string[] = [`${SERVICE_LABELS[service]}: ${dollars(base)} base`];
  let price = base;
  if (turf !== null) {
    price += (rate * turf) / 1000;
    const source = input.turf_source === "traced" ? " traced" : input.turf_source === "estimate" ? " est." : "";
    parts.push(`+ ${dollars(rate)}/1,000 sqft × ${sqft(turf)}${source}`);
  } else {
    parts.push("(turf unknown)");
  }
  if (price < minCharge) {
    price = minCharge;
    parts.push(`→ min charge ${dollars(minCharge)}`);
  }
  const tier = valueTierMultiplier(input.market_value, settings);
  if (tier > 1) {
    price *= tier;
    parts.push(`× ${tier.toFixed(2)} value tier`);
  }

  const mid = Math.round(price);
  const low = Math.max(0, round5(price * LOW_FACTOR));
  const high = Math.max(low, round5(price * HIGH_FACTOR));
  return { low, high, mid, basis: `${parts.join(" ")} = ${dollars(mid)}` };
}

/** A quote range for every service, from the parcel's effective turf and market value. */
export function quoteRangesForAll(
  parcel: TurfParcel & Pick<Parcel, "market_value">,
  settings: QuoteSettings,
): Record<ServiceKey, QuoteRange> {
  const turf_sqft = effectiveTurf(parcel);
  const turf_source = turfSource(parcel);
  const out = {} as Record<ServiceKey, QuoteRange>;
  for (const service of SERVICE_KEYS) {
    out[service] = quoteRange({ turf_sqft, market_value: parcel.market_value, service, turf_source }, settings);
  }
  return out;
}

/** Geodesic area in sqft of traced lawn polygons (a FeatureCollection, or one polygon); 0 for nothing / junk. */
export function tracedAreaSqft(traced: GeoFeatureCollection | ParcelGeom | null | undefined): number {
  if (!traced) return 0;
  if (traced.type === "FeatureCollection" && traced.features.length === 0) return 0;
  try {
    const sqm = area(traced);
    return Number.isFinite(sqm) ? Math.round(sqm * SQFT_PER_SQM * 10) / 10 : 0;
  } catch {
    return 0;
  }
}

/** Spec name for `tracedAreaSqft`. */
export const tracedArea = tracedAreaSqft;

/** "$45–$60" (en dash, thousands separators). */
export function formatRange(range: Pick<QuoteRange, "low" | "high">): string {
  return `${dollars(Math.round(range.low))}–${dollars(Math.round(range.high))}`;
}
