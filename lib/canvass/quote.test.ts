import { describe, expect, it } from "vitest";
import {
  VALUE_TIER_CAP,
  effectiveTurf,
  estimateTurf,
  footprintSqft,
  formatQuote,
  quoteFor,
  quotesForAll,
  seasonService,
  tierFor,
  tracedAreaSqft,
  turfSource,
  valueTierMultiplier,
} from "./quote";
import type { QuoteSettings } from "./quote";
import { DEFAULT_PRICE_TIERS, DEFAULT_TIER_BOUNDS, DEFAULT_TIER_MINUTES, SERVICE_KEYS } from "./types";
import type { GeoFeatureCollection, TierTable } from "./types";

/** Mirrors the canvass_settings column defaults (value tier OFF, no minutes filled in). */
const settings: QuoteSettings = {
  price_tiers: DEFAULT_PRICE_TIERS,
  tier_bounds: DEFAULT_TIER_BOUNDS,
  tier_minutes: DEFAULT_TIER_MINUTES,
  crew_size: 3,
  pay_rate: 15,
  value_tier_enabled: false,
  value_tier_max: 1.1,
};

const lot = { lot_sqft: 10_000, footprint_sqft: null, living_sqft: null, stories: null };
/** A parcel whose effective turf is `n` sqft (traced). */
const turf = (n: number | null, market_value: number | null = null) => ({
  turf_sqft_traced: n,
  turf_sqft_est: null,
  market_value,
});
/** A price table with leaf cleanup + mow filled in. */
const filled = (over: Partial<TierTable> = {}): TierTable => ({
  ...DEFAULT_PRICE_TIERS,
  mow: { small: 35, medium: 45, large: 60, xl: null },
  ...over,
});

/** A ~30 m × 30 m square near Rocky River (≈ 900 m² ≈ 9,688 sqft). */
function square(sideMeters: number, lat = 41.4756, lng = -81.8396): GeoFeatureCollection {
  const dLat = sideMeters / 110_574;
  const dLng = sideMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: null,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng, lat],
              [lng + dLng, lat],
              [lng + dLng, lat + dLat],
              [lng, lat + dLat],
              [lng, lat],
            ],
          ],
        },
      },
    ],
  };
}

describe("turf estimate", () => {
  it("subtracts the footprint and the hardscape share from the lot", () => {
    expect(estimateTurf({ ...lot, footprint_sqft: 1_500 }, 0.12)).toBe(10_000 - 1_500 - 1_200);
  });

  it("derives the footprint from living area ÷ stories when the county has no footprint", () => {
    expect(footprintSqft({ footprint_sqft: null, living_sqft: 2_400, stories: 2 })).toBe(1_200);
    expect(footprintSqft({ footprint_sqft: null, living_sqft: 2_400, stories: null })).toBe(2_400);
    expect(footprintSqft({ footprint_sqft: null, living_sqft: 2_400, stories: 0.5 })).toBe(2_400);
    expect(footprintSqft({ footprint_sqft: 1_000, living_sqft: 2_400, stories: 2 })).toBe(1_000);
    expect(footprintSqft({ footprint_sqft: null, living_sqft: null, stories: null })).toBe(0);
    expect(estimateTurf({ ...lot, living_sqft: 2_400, stories: 2 }, 0.12)).toBe(10_000 - 1_200 - 1_200);
  });

  it("is null without a lot size and never negative", () => {
    expect(estimateTurf({ ...lot, lot_sqft: null }, 0.12)).toBeNull();
    expect(estimateTurf({ ...lot, lot_sqft: Number.NaN }, 0.12)).toBeNull();
    expect(estimateTurf({ ...lot, lot_sqft: 2_000, footprint_sqft: 2_500 }, 0.12)).toBe(0);
    expect(estimateTurf(lot, 0)).toBe(10_000);
    expect(estimateTurf(lot, 5)).toBe(0); // a silly hardscape share is clamped to 100%
  });

  it("traced turf overrides the estimate", () => {
    expect(effectiveTurf({ turf_sqft_traced: 4_321, turf_sqft_est: 8_800 })).toBe(4_321);
    expect(turfSource({ turf_sqft_traced: 4_321, turf_sqft_est: 8_800 })).toBe("traced");
    expect(effectiveTurf({ turf_sqft_traced: null, turf_sqft_est: 8_800 })).toBe(8_800);
    expect(turfSource({ turf_sqft_traced: null, turf_sqft_est: 8_800 })).toBe("estimate");
    expect(effectiveTurf({ turf_sqft_traced: null, turf_sqft_est: null })).toBeNull();
    expect(turfSource({ turf_sqft_traced: null, turf_sqft_est: null })).toBeNull();
  });
});

describe("tierFor", () => {
  it("cuts turf into small / medium / large / xl with inclusive upper bounds", () => {
    expect(tierFor(0, DEFAULT_TIER_BOUNDS)).toBe("small");
    expect(tierFor(3_999, DEFAULT_TIER_BOUNDS)).toBe("small");
    expect(tierFor(4_000, DEFAULT_TIER_BOUNDS)).toBe("small");
    expect(tierFor(4_001, DEFAULT_TIER_BOUNDS)).toBe("medium");
    expect(tierFor(6_000, DEFAULT_TIER_BOUNDS)).toBe("medium");
    expect(tierFor(8_000, DEFAULT_TIER_BOUNDS)).toBe("medium");
    expect(tierFor(8_001, DEFAULT_TIER_BOUNDS)).toBe("large");
    expect(tierFor(12_000, DEFAULT_TIER_BOUNDS)).toBe("large");
    expect(tierFor(12_001, DEFAULT_TIER_BOUNDS)).toBe("xl");
    expect(tierFor(90_000, DEFAULT_TIER_BOUNDS)).toBe("xl");
  });

  it("follows custom bounds", () => {
    const b = { small_max: 2_000, medium_max: 5_000, large_max: 7_000 };
    expect(tierFor(2_500, b)).toBe("medium");
    expect(tierFor(7_500, b)).toBe("xl");
  });

  it("is null when the turf is unknown or junk", () => {
    expect(tierFor(null, DEFAULT_TIER_BOUNDS)).toBeNull();
    expect(tierFor(undefined, DEFAULT_TIER_BOUNDS)).toBeNull();
    expect(tierFor(Number.NaN, DEFAULT_TIER_BOUNDS)).toBeNull();
    expect(tierFor(-5, DEFAULT_TIER_BOUNDS)).toBeNull();
  });
});

describe("quoteFor", () => {
  it("acceptance: turf 6,000 → leaf cleanup $40 (medium tier)", () => {
    const q = quoteFor("leaf_cleanup", turf(6_000), settings);
    expect(q).toEqual({
      service: "leaf_cleanup",
      tier: "medium",
      turfSqft: 6_000,
      status: "priced",
      price: 40,
      label: "$40",
      laborCost: null,
      profit: null,
      underCost: false,
    });
  });

  it("small $30 / large $50 for leaf cleanup, from the county estimate when nothing is traced", () => {
    expect(quoteFor("leaf_cleanup", turf(3_000), settings).label).toBe("$30");
    expect(quoteFor("leaf_cleanup", turf(10_000), settings).label).toBe("$50");
    const est = quoteFor("leaf_cleanup", { turf_sqft_traced: null, turf_sqft_est: 5_000, market_value: null }, settings);
    expect(est).toMatchObject({ tier: "medium", turfSqft: 5_000, price: 40 });
  });

  it("editing price_tiers changes the quote", () => {
    const edited = { ...settings, price_tiers: filled({ leaf_cleanup: { small: 30, medium: 55, large: 50, xl: null } }) };
    expect(quoteFor("leaf_cleanup", turf(6_000), settings).price).toBe(40);
    expect(quoteFor("leaf_cleanup", turf(6_000), edited).price).toBe(55);
  });

  it("an XL lot with no XL price reads Quote on site", () => {
    const q = quoteFor("leaf_cleanup", turf(15_000), settings);
    expect(q).toMatchObject({ tier: "xl", status: "quote_on_site", price: null, label: "Quote on site", profit: null });
    expect(q.underCost).toBe(false);
  });

  it("an XL lot with an XL price is priced", () => {
    const withXl = { ...settings, price_tiers: filled({ leaf_cleanup: { small: 30, medium: 40, large: 50, xl: 90 } }) };
    expect(quoteFor("leaf_cleanup", turf(15_000), withXl)).toMatchObject({ status: "priced", price: 90, label: "$90" });
  });

  it("a service the owner has not filled in reads Owner to fill in", () => {
    const q = quoteFor("mow", turf(6_000), settings);
    expect(q).toMatchObject({ tier: "medium", status: "unpriced", price: null, label: "Owner to fill in" });
    // a single blank cell in an otherwise priced service
    const gap = { ...settings, price_tiers: filled({ leaf_cleanup: { small: 30, medium: null, large: 50, xl: null } }) };
    expect(quoteFor("leaf_cleanup", turf(6_000), gap).status).toBe("unpriced");
  });

  it("unknown turf reads Lot size unknown, with no tier and no money", () => {
    const q = quoteFor("leaf_cleanup", turf(null), settings);
    expect(q).toEqual({
      service: "leaf_cleanup",
      tier: null,
      turfSqft: null,
      status: "unknown_turf",
      price: null,
      label: "Lot size unknown",
      laborCost: null,
      profit: null,
      underCost: false,
    });
  });

  it("a traced area of 0 sqft is a known (small) lot", () => {
    expect(quoteFor("leaf_cleanup", turf(0), settings)).toMatchObject({ tier: "small", price: 30 });
  });

  it("labor cost and profit: crew_size × pay_rate × minutes ÷ 60 against the price", () => {
    const withMinutes = {
      ...settings,
      tier_minutes: { ...DEFAULT_TIER_MINUTES, leaf_cleanup: { small: 20, medium: 30, large: 45, xl: null } },
    };
    // 3 × $15 × 30 / 60 = $22.50 labor on a $40 medium job
    const q = quoteFor("leaf_cleanup", turf(6_000), withMinutes);
    expect(q).toMatchObject({ price: 40, laborCost: 22.5, profit: 17.5, underCost: false });
  });

  it("profit goes negative (underCost) when the minutes make labor exceed the price", () => {
    const slow = {
      ...settings,
      tier_minutes: { ...DEFAULT_TIER_MINUTES, leaf_cleanup: { small: 20, medium: 60, large: 45, xl: null } },
    };
    // 3 × $15 × 60 / 60 = $45 labor on a $40 job
    const q = quoteFor("leaf_cleanup", turf(6_000), slow);
    expect(q).toMatchObject({ price: 40, laborCost: 45, profit: -5, underCost: true });
    // a price of exactly break-even is not under cost
    const even = { ...slow, tier_minutes: { ...DEFAULT_TIER_MINUTES, leaf_cleanup: { small: null, medium: 53.3333333, large: null, xl: null } } };
    expect(quoteFor("leaf_cleanup", turf(6_000), even).underCost).toBe(false);
  });

  it("labor shows even when the service is unpriced, but profit needs a price", () => {
    const withMinutes = { ...settings, tier_minutes: { ...DEFAULT_TIER_MINUTES, mow: { small: 10, medium: 20, large: 30, xl: 60 } } };
    const q = quoteFor("mow", turf(6_000), withMinutes);
    expect(q).toMatchObject({ status: "unpriced", price: null, laborCost: 15, profit: null, underCost: false });
    const xl = quoteFor("mow", turf(15_000), withMinutes);
    expect(xl).toMatchObject({ status: "quote_on_site", laborCost: 45, profit: null, underCost: false });
  });

  it("crew size and pay rate drive the labor cost; junk values are tolerated", () => {
    const base = { ...settings, tier_minutes: { ...DEFAULT_TIER_MINUTES, leaf_cleanup: { small: null, medium: 60, large: null, xl: null } } };
    expect(quoteFor("leaf_cleanup", turf(6_000), { ...base, crew_size: 2, pay_rate: 20 }).laborCost).toBe(40);
    expect(quoteFor("leaf_cleanup", turf(6_000), { ...base, crew_size: Number.NaN, pay_rate: Number.NaN }).laborCost).toBe(0);
    expect(quoteFor("leaf_cleanup", turf(6_000), { ...base, crew_size: 0, pay_rate: 10 }).laborCost).toBe(10);
  });

  it("value tier is off by default: an expensive house pays the same", () => {
    expect(settings.value_tier_enabled).toBe(false);
    const cheap = quoteFor("leaf_cleanup", turf(6_000, 150_000), settings);
    const pricey = quoteFor("leaf_cleanup", turf(6_000, 900_000), settings);
    expect(pricey).toEqual(cheap);
    expect(valueTierMultiplier(900_000, settings)).toBe(1);
  });

  it("value tier when enabled: full at ≥ $400k, half at ≥ $250k, none below, none when the value is unknown", () => {
    const on = { ...settings, value_tier_enabled: true, value_tier_max: 1.1 };
    expect(valueTierMultiplier(500_000, on)).toBe(1.1);
    expect(valueTierMultiplier(400_000, on)).toBe(1.1);
    expect(valueTierMultiplier(300_000, on)).toBe(1.05);
    expect(valueTierMultiplier(250_000, on)).toBe(1.05);
    expect(valueTierMultiplier(200_000, on)).toBe(1);
    expect(valueTierMultiplier(null, on)).toBe(1);
    expect(quoteFor("leaf_cleanup", turf(6_000, 500_000), on)).toMatchObject({ price: 44, label: "$44" });
    expect(quoteFor("leaf_cleanup", turf(6_000, 300_000), on)).toMatchObject({ price: 42, label: "$42" });
    expect(quoteFor("leaf_cleanup", turf(6_000, 100_000), on).price).toBe(40);
    expect(quoteFor("leaf_cleanup", turf(6_000, null), on).price).toBe(40);
  });

  it("value tier raises the price, and so the profit, but never touches unpriced / quote-on-site / unknown turf", () => {
    const on = {
      ...settings,
      value_tier_enabled: true,
      tier_minutes: { ...DEFAULT_TIER_MINUTES, leaf_cleanup: { small: null, medium: 30, large: null, xl: null } },
    };
    expect(quoteFor("leaf_cleanup", turf(6_000, 500_000), on)).toMatchObject({ price: 44, laborCost: 22.5, profit: 21.5 });
    expect(quoteFor("leaf_cleanup", turf(15_000, 500_000), on)).toMatchObject({ status: "quote_on_site", price: null });
    expect(quoteFor("mow", turf(6_000, 500_000), on)).toMatchObject({ status: "unpriced", price: null });
    expect(quoteFor("leaf_cleanup", turf(null, 500_000), on)).toMatchObject({ status: "unknown_turf", price: null });
  });

  it("caps the value tier at ×1.10 in code regardless of settings", () => {
    const greedy = { ...settings, value_tier_enabled: true, value_tier_max: 1.5 };
    expect(VALUE_TIER_CAP).toBe(1.1);
    expect(valueTierMultiplier(1_000_000, greedy)).toBe(1.1);
    expect(valueTierMultiplier(300_000, greedy)).toBe(1.05);
    expect(quoteFor("leaf_cleanup", turf(6_000, 1_000_000), greedy).price).toBe(44);
    // and a max below 1 can never discount
    expect(valueTierMultiplier(1_000_000, { ...greedy, value_tier_max: 0.5 })).toBe(1);
  });

  it("tolerates junk settings values", () => {
    const junk = {
      ...settings,
      price_tiers: { ...DEFAULT_PRICE_TIERS, leaf_cleanup: { small: Number.NaN, medium: -3, large: 50, xl: null } } as TierTable,
      value_tier_enabled: true,
      value_tier_max: Number.NaN,
    };
    expect(quoteFor("leaf_cleanup", turf(2_000, 500_000), junk)).toMatchObject({ status: "unpriced", label: "Owner to fill in" });
    expect(quoteFor("leaf_cleanup", turf(6_000, 500_000), junk)).toMatchObject({ status: "unpriced" });
    expect(quoteFor("leaf_cleanup", turf(10_000, 500_000), junk)).toMatchObject({ status: "priced", price: 50 });
    // a missing table behaves like all-blank
    expect(quoteFor("leaf_cleanup", turf(6_000), { ...settings, price_tiers: undefined as never }).status).toBe("unpriced");
  });
});

describe("quotesForAll", () => {
  it("quotes every service from the parcel's effective turf (traced wins)", () => {
    const all = quotesForAll({ turf_sqft_traced: 3_000, turf_sqft_est: 9_000, market_value: null }, { ...settings, price_tiers: filled() });
    expect(Object.keys(all).sort()).toEqual([...SERVICE_KEYS].sort());
    expect(all.leaf_cleanup).toMatchObject({ tier: "small", price: 30 });
    expect(all.mow).toMatchObject({ tier: "small", price: 35 });
    expect(all.edge).toMatchObject({ status: "unpriced", label: "Owner to fill in" });
    const est = quotesForAll({ turf_sqft_traced: null, turf_sqft_est: 9_000, market_value: null }, { ...settings, price_tiers: filled() });
    expect(est.leaf_cleanup).toMatchObject({ tier: "large", price: 50 });
    expect(est.mow.price).toBe(60);
  });

  it("every service reads Lot size unknown when the lot is unknown", () => {
    const all = quotesForAll(turf(null), settings);
    for (const service of SERVICE_KEYS) expect(all[service]).toMatchObject({ status: "unknown_turf", label: "Lot size unknown" });
  });
});

describe("traced area", () => {
  it("measures a FeatureCollection of lawn polygons in sqft via @turf/area", () => {
    const sqft = tracedAreaSqft(square(30));
    expect(sqft).toBeGreaterThan(9_688 * 0.98);
    expect(sqft).toBeLessThan(9_688 * 1.02);
    const two = { ...square(30), features: [...square(30).features, ...square(10, 41.48, -81.84).features] };
    expect(tracedAreaSqft(two)).toBeCloseTo(sqft + tracedAreaSqft(square(10, 41.48, -81.84)), 0);
    expect(tracedAreaSqft(square(30).features[0].geometry)).toBeCloseTo(sqft, 0);
  });

  it("is 0 for nothing or a broken geometry", () => {
    expect(tracedAreaSqft(null)).toBe(0);
    expect(tracedAreaSqft({ type: "FeatureCollection", features: [] })).toBe(0);
    expect(tracedAreaSqft({ type: "Polygon", coordinates: [] })).toBe(0);
  });
});

describe("formatting and season", () => {
  it("formats each quote status", () => {
    expect(formatQuote({ status: "priced", price: 40 })).toBe("$40");
    expect(formatQuote({ status: "priced", price: 1_200 })).toBe("$1,200");
    expect(formatQuote({ status: "priced", price: 42.5 })).toBe("$42.50");
    expect(formatQuote({ status: "quote_on_site", price: null })).toBe("Quote on site");
    expect(formatQuote({ status: "unpriced", price: null })).toBe("Owner to fill in");
    expect(formatQuote({ status: "unknown_turf", price: null })).toBe("Lot size unknown");
    expect(formatQuote(quoteFor("leaf_cleanup", turf(6_000), settings))).toBe("$40");
  });

  it("re-exports the season service", () => {
    expect(seasonService(10)).toBe("leaf_cleanup");
  });
});
