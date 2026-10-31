/**
 * Door quotes for the Canvass tab. Pure: no next/* or db imports.
 *
 * Turf comes from the county estimate (lot − building footprint − a hardscape share) unless the crew traced the
 * lawn on the satellite map, in which case the traced area wins. The turf picks a lot-size tier (small / medium /
 * large / xl, cut by `tier_bounds`) and every service has ONE owner-set price per tier (`price_tiers`). A blank price
 * is "Owner to fill in"; a blank XL price is "Quote on site". When the owner turns the value tier on, priced tiers
 * are nudged up by a multiplier the code caps at ×1.10 whatever the settings say.
 *
 * Owner pages also get a profit check: crew_size × pay_rate × the tier's minutes ÷ 60 against the price. Crew-facing
 * surfaces show only `label`.
 */
import area from "@turf/area";
import type { CanvassSettings, Parcel } from "../db/types";
import { SERVICE_KEYS } from "./types";
import type { GeoFeatureCollection, ParcelGeom, Quote, ServiceKey, TierBounds, TierKey } from "./types";

export { seasonService } from "./season";

export const SQFT_PER_SQM = 10.7639;

/** The value tier can never add more than 10%, even if the settings row says otherwise. */
export const VALUE_TIER_CAP = 1.1;
/** Market value at which the full value-tier multiplier applies. */
export const VALUE_TIER_FULL_AT = 400_000;
/** Market value at which half of the value-tier multiplier applies. */
export const VALUE_TIER_HALF_AT = 250_000;

export type TurfInput = Pick<Parcel, "lot_sqft" | "footprint_sqft" | "living_sqft" | "stories">;
export type TurfParcel = Pick<Parcel, "turf_sqft_traced" | "turf_sqft_est">;
export type QuoteSettings = Pick<
  CanvassSettings,
  "price_tiers" | "tier_bounds" | "tier_minutes" | "crew_size" | "pay_rate" | "value_tier_enabled" | "value_tier_max"
>;

export type TurfSource = "traced" | "estimate";

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cents = (n: number): number => Math.round(n * 100) / 100;

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

/**
 * The lot-size tier for a turf area: small ≤ `small_max`, medium ≤ `medium_max`, large ≤ `large_max`, xl above
 * (the upper bound of each tier is inclusive). Null when the turf is unknown.
 */
export function tierFor(turfSqft: number | null | undefined, bounds: TierBounds): TierKey | null {
  if (!finite(turfSqft) || turfSqft < 0) return null;
  if (turfSqft <= bounds.small_max) return "small";
  if (turfSqft <= bounds.medium_max) return "medium";
  if (turfSqft <= bounds.large_max) return "large";
  return "xl";
}

/** The text for a quote: "$40", "Quote on site", "Owner to fill in" or "Lot size unknown". */
export function formatQuote(q: Pick<Quote, "status" | "price">): string {
  switch (q.status) {
    case "priced":
      return finite(q.price) ? dollars(q.price) : "Owner to fill in";
    case "quote_on_site":
      return "Quote on site";
    case "unpriced":
      return "Owner to fill in";
    case "unknown_turf":
      return "Lot size unknown";
  }
}

const cell = (table: QuoteSettings["price_tiers"] | undefined, service: ServiceKey, tier: TierKey): number | null => {
  const v = table?.[service]?.[tier];
  return finite(v) && v >= 0 ? v : null;
};

/**
 * One service's quote for a house: the tier from its effective turf, the owner's price for that tier (after the
 * value-tier multiplier when enabled; priced tiers only), and the labor / profit check when the tier has minutes.
 */
export function quoteFor(
  service: ServiceKey,
  parcel: TurfParcel & { market_value?: number | null },
  settings: QuoteSettings,
): Quote {
  const turfSqft = effectiveTurf(parcel);
  const tier = tierFor(turfSqft, settings.tier_bounds);
  if (tier === null) {
    const unknown = { service, tier, turfSqft, price: null, laborCost: null, profit: null, underCost: false } as const;
    return { ...unknown, status: "unknown_turf", label: formatQuote({ status: "unknown_turf", price: null }) };
  }

  const base = cell(settings.price_tiers, service, tier);
  const price = base === null ? null : cents(base * valueTierMultiplier(parcel.market_value, settings));
  const status: Quote["status"] = price !== null ? "priced" : tier === "xl" ? "quote_on_site" : "unpriced";

  const minutes = cell(settings.tier_minutes, service, tier);
  const crew = finite(settings.crew_size) ? Math.max(1, settings.crew_size) : 1;
  const rate = finite(settings.pay_rate) ? Math.max(0, settings.pay_rate) : 0;
  const laborCost = minutes === null ? null : cents((crew * rate * minutes) / 60);
  const profit = price !== null && laborCost !== null ? cents(price - laborCost) : null;

  return {
    service,
    tier,
    turfSqft,
    status,
    price,
    label: formatQuote({ status, price }),
    laborCost,
    profit,
    underCost: profit !== null && profit < 0,
  };
}

/** A quote for every service, from the parcel's effective turf and market value. */
export function quotesForAll(
  parcel: TurfParcel & { market_value?: number | null },
  settings: QuoteSettings,
): Record<ServiceKey, Quote> {
  const out = {} as Record<ServiceKey, Quote>;
  for (const service of SERVICE_KEYS) out[service] = quoteFor(service, parcel, settings);
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
