import { describe, expect, it } from "vitest";
import type { MinutesRule } from "./db/types";
import {
  DEFAULT_LOT_ACRES,
  estimateHours,
  estimateMinutes,
  explainPrice,
  fee,
  moneyRound,
  priceItem,
  priceQuote,
  profit,
  type PricingSettings,
} from "./pricing";

const settings: PricingSettings = {
  default_wage: 15,
  margin: 0.5,
  min_job_price: null,
  card_fee_pct: 0.029,
  card_fee_fixed: 0.3,
};

const rule: MinutesRule = {
  base: 30,
  per_acre: 60,
  tree_cover: { none: 1, light: 1.25, medium: 1.5, heavy: 2 },
};

describe("moneyRound", () => {
  it("rounds to cents", () => {
    expect(moneyRound(2.905)).toBe(2.91);
    expect(moneyRound(1.005)).toBe(1.01);
    expect(moneyRound(42.094999)).toBe(42.09);
    expect(moneyRound(0)).toBe(0);
  });
  it("throws on non-finite", () => {
    expect(() => moneyRound(NaN)).toThrow(RangeError);
  });
});

describe("priceItem", () => {
  it("plan case: $15/hr, 2 crew, 1.5 h, 50% margin -> labor $45, price $90", () => {
    expect(priceItem({ crew_size: 2, est_hours: 1.5 }, settings)).toEqual({ labor: 45, price: 90 });
  });

  it("does not apply the minimum to a single item", () => {
    const s = { ...settings, min_job_price: 100 };
    expect(priceItem({ crew_size: 1, est_hours: 1, }, s)).toEqual({ labor: 15, price: 30 });
  });

  it("rounds price to whole dollars", () => {
    // labor 10 / (1 - 0.35) = 15.3846...
    const r = priceItem({ crew_size: 1, est_hours: 1, wage: 10, margin: 0.35 }, settings);
    expect(r).toEqual({ labor: 10, price: 15 });
  });

  it("per-item wage and margin overrides win over settings", () => {
    const r = priceItem({ crew_size: 2, est_hours: 2, wage: 20, margin: 0.6 }, settings);
    expect(r).toEqual({ labor: 80, price: 200 });
  });

  it("allows zero margin and zero hours", () => {
    expect(priceItem({ crew_size: 2, est_hours: 1, margin: 0 }, settings)).toEqual({ labor: 30, price: 30 });
    expect(priceItem({ crew_size: 2, est_hours: 0 }, settings)).toEqual({ labor: 0, price: 0 });
  });

  it("throws RangeError on invalid inputs", () => {
    expect(() => priceItem({ crew_size: 2, est_hours: -1 }, settings)).toThrow(RangeError);
    expect(() => priceItem({ crew_size: 2, est_hours: -1 }, settings)).toThrow(/est_hours/);
    expect(() => priceItem({ crew_size: 2, est_hours: 1, margin: 1 }, settings)).toThrow(RangeError);
    expect(() => priceItem({ crew_size: 2, est_hours: 1, margin: 1.2 }, settings)).toThrow(/margin/);
    expect(() => priceItem({ crew_size: 2, est_hours: 1, margin: -0.1 }, settings)).toThrow(RangeError);
    expect(() => priceItem({ crew_size: 0, est_hours: 1 }, settings)).toThrow(/crew_size/);
    expect(() => priceItem({ crew_size: 1, est_hours: 1, wage: -5 }, settings)).toThrow(/wage/);
    expect(() => priceItem({ crew_size: 1, est_hours: NaN }, settings)).toThrow(RangeError);
    expect(() => priceItem({ crew_size: 1, est_hours: 1 }, { ...settings, margin: 1 })).toThrow(RangeError);
  });
});

describe("fee and profit", () => {
  it("fee on $90 at 2.9% + $0.30 = $2.91", () => {
    expect(fee(90, settings)).toBe(2.91);
  });
  it("profit on $90 with $45 labor = $42.09", () => {
    expect(profit(90, 45, settings)).toBe(42.09);
  });
  it("no fee on a zero price", () => {
    expect(fee(0, settings)).toBe(0);
  });
  it("rejects negative price", () => {
    expect(() => fee(-1, settings)).toThrow(RangeError);
  });
});

describe("priceQuote", () => {
  it("plan case totals", () => {
    const t = priceQuote([{ crew_size: 2, est_hours: 1.5 }], settings);
    expect(t.labor_total).toBe(45);
    expect(t.price_total).toBe(90);
    expect(t.fee_total).toBe(2.91);
    expect(t.profit_total).toBe(42.09);
    expect(t.items).toEqual([{ labor: 45, price: 90 }]);
    expect(t.needs_owner).toBe(false);
    expect(t.min_applied).toBe(false);
  });

  it("sums several items and computes fee/profit on the total", () => {
    const t = priceQuote(
      [
        { crew_size: 2, est_hours: 1.5 },
        { crew_size: 1, est_hours: 1 },
      ],
      settings,
    );
    expect(t.labor_total).toBe(60);
    expect(t.price_total).toBe(120);
    expect(t.fee_total).toBe(3.78);
    expect(t.profit_total).toBe(56.22);
  });

  it("applies the min_job_price floor and flags it", () => {
    const s = { ...settings, min_job_price: 150 };
    const t = priceQuote([{ crew_size: 2, est_hours: 1.5 }], s);
    expect(t.min_applied).toBe(true);
    expect(t.price_total).toBe(150);
    expect(t.labor_total).toBe(45);
    expect(t.items[0]!.price).toBe(90); // item price itself is unchanged
    expect(t.fee_total).toBe(4.65); // 150 * .029 + .30
    expect(t.profit_total).toBe(100.35);
  });

  it("does not flag min_applied when the sum meets or exceeds the floor", () => {
    expect(priceQuote([{ crew_size: 2, est_hours: 1.5 }], { ...settings, min_job_price: 90 }).min_applied).toBe(false);
    expect(priceQuote([{ crew_size: 2, est_hours: 1.5 }], { ...settings, min_job_price: 50 }).min_applied).toBe(false);
  });

  it("custom item without a price needs the owner and is excluded from totals", () => {
    const t = priceQuote(
      [
        { crew_size: 2, est_hours: 1.5 },
        { crew_size: 3, est_hours: 4, is_custom: true, status: "needs_owner", price: null },
      ],
      settings,
    );
    expect(t.needs_owner).toBe(true);
    expect(t.price_total).toBe(90);
    expect(t.labor_total).toBe(45);
    expect(t.items[1]).toEqual({ labor: 0, price: 0 });
  });

  it("status needs_owner alone marks an item custom; is_custom alone too", () => {
    expect(priceQuote([{ crew_size: 1, est_hours: 1, status: "needs_owner" }], settings).needs_owner).toBe(true);
    expect(priceQuote([{ crew_size: 1, est_hours: 1, is_custom: true }], settings).needs_owner).toBe(true);
  });

  it("custom item with an owner price is included, labor from crew x hours x wage", () => {
    const t = priceQuote(
      [
        { crew_size: 2, est_hours: 1.5 },
        { crew_size: 2, est_hours: 3, is_custom: true, status: "priced", price: 200 },
      ],
      settings,
    );
    expect(t.needs_owner).toBe(false);
    expect(t.items[1]).toEqual({ labor: 90, price: 200 });
    expect(t.labor_total).toBe(135);
    expect(t.price_total).toBe(290);
    expect(t.fee_total).toBe(8.71); // 290 * .029 + .30 = 8.71
    expect(t.profit_total).toBe(146.29);
  });

  it("a custom item with an owner price of 0 counts as priced", () => {
    const t = priceQuote([{ crew_size: 1, est_hours: 1, is_custom: true, price: 0 }], settings);
    expect(t.needs_owner).toBe(false);
  });

  it("margin override changes standard items but not owner prices", () => {
    const t = priceQuote(
      [
        { crew_size: 2, est_hours: 1.5 },
        { crew_size: 1, est_hours: 2, is_custom: true, price: 100 },
      ],
      settings,
      { margin: 0.25 },
    );
    expect(t.items[0]).toEqual({ labor: 45, price: 60 });
    expect(t.items[1]).toEqual({ labor: 30, price: 100 });
    expect(t.price_total).toBe(160);
  });

  it("wage override feeds labor and price", () => {
    const t = priceQuote([{ crew_size: 2, est_hours: 1.5 }], settings, { wage: 20 });
    expect(t.labor_total).toBe(60);
    expect(t.price_total).toBe(120);
  });

  it("declined and referred items are not billed and do not need the owner", () => {
    const t = priceQuote(
      [
        { crew_size: 2, est_hours: 1.5 },
        { crew_size: 3, est_hours: 8, is_custom: true, status: "referred" },
        { crew_size: 3, est_hours: 8, is_custom: true, status: "declined" },
      ],
      settings,
    );
    expect(t.needs_owner).toBe(false);
    expect(t.price_total).toBe(90);
  });

  it("empty quote totals zero with no fee (and floor if set)", () => {
    const t = priceQuote([], settings);
    expect(t).toMatchObject({ labor_total: 0, price_total: 0, fee_total: 0, profit_total: 0, min_applied: false });
    const f = priceQuote([], { ...settings, min_job_price: 40 });
    expect(f.price_total).toBe(40);
    expect(f.min_applied).toBe(true);
  });

  it("throws RangeError on invalid margin or hours", () => {
    expect(() => priceQuote([{ crew_size: 1, est_hours: 1 }], settings, { margin: 1 })).toThrow(RangeError);
    expect(() => priceQuote([{ crew_size: 1, est_hours: 1 }], { ...settings, margin: 1.5 })).toThrow(RangeError);
    expect(() => priceQuote([{ crew_size: 1, est_hours: -2 }], settings)).toThrow(RangeError);
    expect(() => priceQuote([{ crew_size: 1, est_hours: 1, is_custom: true, price: -5 }], settings)).toThrow(RangeError);
  });
});

describe("estimateMinutes", () => {
  it("documents the default lot size", () => {
    expect(DEFAULT_LOT_ACRES).toBe(0.25);
  });

  it("base + per_acre x acres, rounded up to 5 min", () => {
    // 30 + 60 * 0.5 = 60
    expect(estimateMinutes(rule, 0.5, "none")).toBe(60);
    // 30 + 60 * 0.3 = 48 -> 50
    expect(estimateMinutes(rule, 0.3, "none")).toBe(50);
    // 30 + 60 * 0.26 = 45.6 -> 50
    expect(estimateMinutes(rule, 0.26, null)).toBe(50);
  });

  it("applies tree cover multipliers", () => {
    // base 60 at 0.5 acres
    expect(estimateMinutes(rule, 0.5, "none")).toBe(60);
    expect(estimateMinutes(rule, 0.5, "light")).toBe(75);
    expect(estimateMinutes(rule, 0.5, "medium")).toBe(90);
    expect(estimateMinutes(rule, 0.5, "heavy")).toBe(120);
  });

  it("null tree cover behaves as none", () => {
    expect(estimateMinutes(rule, 0.5, null)).toBe(estimateMinutes(rule, 0.5, "none"));
  });

  it("null acres uses DEFAULT_LOT_ACRES", () => {
    expect(estimateMinutes(rule, null, "none")).toBe(estimateMinutes(rule, DEFAULT_LOT_ACRES, "none"));
    // 30 + 60 * 0.25 = 45
    expect(estimateMinutes(rule, null, "none")).toBe(45);
  });

  it("rounds up, not to nearest", () => {
    // 31 min -> 35 ; 30.01 -> 35
    expect(estimateMinutes({ ...rule, base: 31, per_acre: 0 }, 1, "none")).toBe(35);
    expect(estimateMinutes({ ...rule, base: 30.01, per_acre: 0 }, 1, "none")).toBe(35);
    // exact multiple stays put
    expect(estimateMinutes({ ...rule, base: 30, per_acre: 0 }, 1, "none")).toBe(30);
  });

  it("is not thrown off by floating-point noise", () => {
    // 0.1 + 0.2 style noise: 20 + 100 * 0.3 = 50.00000000000001 in binary
    expect(estimateMinutes({ ...rule, base: 20, per_acre: 100 }, 0.3, "none")).toBe(50);
  });

  it("has a 15 minute minimum", () => {
    expect(estimateMinutes({ ...rule, base: 5, per_acre: 0 }, 0, "none")).toBe(15);
    expect(estimateMinutes({ ...rule, base: 0, per_acre: 0 }, 1, "none")).toBe(15);
  });

  it("throws RangeError on invalid inputs", () => {
    expect(() => estimateMinutes(rule, -1, "none")).toThrow(RangeError);
    expect(() => estimateMinutes({ ...rule, base: -5 }, 1, "none")).toThrow(RangeError);
    expect(() => estimateMinutes(rule, NaN, "none")).toThrow(RangeError);
  });
});

describe("estimateHours", () => {
  it("rounds up to 0.25 h", () => {
    // 60 min -> 1
    expect(estimateHours(rule, 0.5, "none")).toBe(1);
    // 48 min = 0.8 h -> 1
    expect(estimateHours(rule, 0.3, "none")).toBe(1);
    // 45 min -> 0.75
    expect(estimateHours(rule, null, "none")).toBe(0.75);
    // 75 min -> 1.25
    expect(estimateHours(rule, 0.5, "light")).toBe(1.25);
    // 120 min -> 2
    expect(estimateHours(rule, 0.5, "heavy")).toBe(2);
  });
  it("minimum is 0.25 h", () => {
    expect(estimateHours({ ...rule, base: 1, per_acre: 0 }, 0, "none")).toBe(0.25);
  });
  it("feeds priceItem for the plan case", () => {
    // 90 minutes -> 1.5 h
    const h = estimateHours(rule, 0.5, "medium");
    expect(h).toBe(1.5);
    expect(priceItem({ crew_size: 2, est_hours: h }, settings)).toEqual({ labor: 45, price: 90 });
  });
});

describe("explainPrice", () => {
  it("matches the approval card format", () => {
    expect(explainPrice({ crew_size: 2, est_hours: 1.5 }, settings)).toBe(
      "2 crew × 1.5 h × $15 = $45 labor; ÷ (1 − 50%) = $90",
    );
  });
  it("reflects overrides and cents", () => {
    expect(explainPrice({ crew_size: 1, est_hours: 1, wage: 15.5, margin: 0.35 }, settings)).toBe(
      "1 crew × 1 h × $15.50 = $15.50 labor; ÷ (1 − 35%) = $24",
    );
  });
  it("throws on invalid input", () => {
    expect(() => explainPrice({ crew_size: 1, est_hours: 1, margin: 1 }, settings)).toThrow(RangeError);
  });
});
