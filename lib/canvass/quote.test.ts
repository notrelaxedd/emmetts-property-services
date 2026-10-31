import { describe, expect, it } from "vitest";
import {
  VALUE_TIER_CAP,
  effectiveTurf,
  estimateTurf,
  footprintSqft,
  formatRange,
  quoteRange,
  quoteRangesForAll,
  round5,
  seasonService,
  tracedAreaSqft,
  turfSource,
  valueTierMultiplier,
} from "./quote";
import type { QuoteSettings } from "./quote";
import { DEFAULT_BASE_PRICES, SERVICE_KEYS } from "./types";
import type { GeoFeatureCollection } from "./types";

/** Mirrors the canvass_settings column defaults (value tier OFF). */
const settings: QuoteSettings = {
  base_prices: DEFAULT_BASE_PRICES,
  rate_per_1000_sqft: 6,
  min_charge: 40,
  value_tier_enabled: false,
  value_tier_max: 1.1,
};

const lot = { lot_sqft: 10_000, footprint_sqft: null, living_sqft: null, stories: null };

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

describe("quote range", () => {
  it("is base + rate per 1,000 sqft, with low = round5(0.9×) and high = round5(1.15×)", () => {
    const q = quoteRange({ turf_sqft: 8_000, market_value: null, service: "mow" }, settings);
    // 35 + 6 × 8 = 83
    expect(q.mid).toBe(83);
    expect(q.low).toBe(round5(83 * 0.9)); // 74.7 → 75
    expect(q.high).toBe(round5(83 * 1.15)); // 95.45 → 95
    expect(q).toMatchObject({ low: 75, high: 95 });
    expect(q.basis).toBe("Mowing: $35 base + $6/1,000 sqft × 8,000 sqft = $83");
  });

  it("applies the minimum charge", () => {
    const q = quoteRange({ turf_sqft: 1_000, market_value: null, service: "edge" }, settings);
    // 15 + 6 = 21 → min 40
    expect(q.mid).toBe(40);
    expect(q.low).toBe(35);
    expect(q.high).toBe(45);
    expect(q.basis).toContain("→ min charge $40");
  });

  it("quotes the base price alone when turf is unknown", () => {
    const q = quoteRange({ turf_sqft: null, market_value: null, service: "leaf_cleanup" }, settings);
    expect(q.mid).toBe(150);
    expect(q.basis).toContain("(turf unknown)");
  });

  it("names the turf source in the basis", () => {
    expect(quoteRange({ turf_sqft: 8_000, market_value: null, service: "mow", turf_source: "traced" }, settings).basis).toContain(
      "8,000 sqft traced",
    );
    expect(quoteRange({ turf_sqft: 8_000, market_value: null, service: "mow", turf_source: "estimate" }, settings).basis).toContain(
      "8,000 sqft est.",
    );
  });

  it("value tier is off by default: an expensive house pays the same", () => {
    expect(settings.value_tier_enabled).toBe(false);
    const cheap = quoteRange({ turf_sqft: 8_000, market_value: 150_000, service: "mow" }, settings);
    const pricey = quoteRange({ turf_sqft: 8_000, market_value: 900_000, service: "mow" }, settings);
    expect(pricey).toEqual(cheap);
    expect(valueTierMultiplier(900_000, settings)).toBe(1);
    expect(cheap.basis).not.toContain("value tier");
  });

  it("value tier when enabled: full at ≥ $400k, half at ≥ $250k, none below, none when the value is unknown", () => {
    const on = { ...settings, value_tier_enabled: true, value_tier_max: 1.1 };
    expect(valueTierMultiplier(500_000, on)).toBe(1.1);
    expect(valueTierMultiplier(400_000, on)).toBe(1.1);
    expect(valueTierMultiplier(300_000, on)).toBe(1.05);
    expect(valueTierMultiplier(250_000, on)).toBe(1.05);
    expect(valueTierMultiplier(200_000, on)).toBe(1);
    expect(valueTierMultiplier(null, on)).toBe(1);
    const q = quoteRange({ turf_sqft: 8_000, market_value: 500_000, service: "mow" }, on);
    // 83 × 1.1 = 91.3
    expect(q.mid).toBe(91);
    expect(q.low).toBe(80);
    expect(q.high).toBe(105);
    expect(q.basis).toContain("× 1.10 value tier");
  });

  it("caps the value tier at ×1.10 in code regardless of settings", () => {
    const greedy = { ...settings, value_tier_enabled: true, value_tier_max: 1.5 };
    expect(VALUE_TIER_CAP).toBe(1.1);
    expect(valueTierMultiplier(1_000_000, greedy)).toBe(1.1);
    expect(valueTierMultiplier(300_000, greedy)).toBe(1.05);
    const q = quoteRange({ turf_sqft: 8_000, market_value: 1_000_000, service: "mow" }, greedy);
    expect(q.mid).toBe(91);
    // and a max below 1 can never discount
    expect(valueTierMultiplier(1_000_000, { ...greedy, value_tier_max: 0.5 })).toBe(1);
  });

  it("tolerates junk settings values", () => {
    const junk = {
      base_prices: { ...DEFAULT_BASE_PRICES, mow: Number.NaN },
      rate_per_1000_sqft: -3,
      min_charge: Number.NaN,
      value_tier_enabled: true,
      value_tier_max: Number.NaN,
    };
    const q = quoteRange({ turf_sqft: 8_000, market_value: 500_000, service: "mow" }, junk);
    expect(q).toEqual({ low: 0, high: 0, mid: 0, basis: "Mowing: $0 base + $0/1,000 sqft × 8,000 sqft = $0" });
  });

  it("quotes every service from the parcel's effective turf (traced wins)", () => {
    const all = quoteRangesForAll({ turf_sqft_traced: 4_000, turf_sqft_est: 8_000, market_value: null }, settings);
    expect(Object.keys(all).sort()).toEqual([...SERVICE_KEYS].sort());
    // mow: 35 + 24 = 59
    expect(all.mow.mid).toBe(59);
    expect(all.mow.basis).toContain("4,000 sqft traced");
    // snow: 45 + 24 = 69
    expect(all.snow).toMatchObject({ mid: 69, low: 60, high: 80 });
    const est = quoteRangesForAll({ turf_sqft_traced: null, turf_sqft_est: 8_000, market_value: null }, settings);
    expect(est.mow.mid).toBe(83);
    expect(est.mow.basis).toContain("est.");
  });

  it("updates live when settings change", () => {
    const before = quoteRange({ turf_sqft: 8_000, market_value: null, service: "mow" }, settings);
    const after = quoteRange({ turf_sqft: 8_000, market_value: null, service: "mow" }, { ...settings, rate_per_1000_sqft: 10 });
    expect(before.mid).toBe(83);
    expect(after.mid).toBe(115);
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
  it("formats a range as $low–$high", () => {
    expect(formatRange({ low: 45, high: 60 })).toBe("$45–$60");
    expect(formatRange({ low: 1_200, high: 1_500 })).toBe("$1,200–$1,500");
    expect(formatRange({ low: 44.6, high: 60.2 })).toBe("$45–$60");
  });

  it("re-exports the season service", () => {
    expect(seasonService(10)).toBe("leaf_cleanup");
  });

  it("round5 rounds to the nearest $5", () => {
    expect(round5(72.4)).toBe(70);
    expect(round5(72.5)).toBe(75);
    expect(round5(0)).toBe(0);
  });
});
