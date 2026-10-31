import { describe, expect, it } from "vitest";
import { profitText, underCostText } from "@/components/admin/canvass/quote-card";

describe("quote card helpers", () => {
  it("shows labor and profit for a priced quote with minutes", () => {
    expect(profitText({ price: 40, laborCost: 22.5, profit: 17.5 })).toBe("Labor $22.50 · Profit $17.50");
    expect(profitText({ price: 40, laborCost: 30, profit: 10 })).toBe("Labor $30 · Profit $10");
  });

  it("shows a negative profit with a minus sign", () => {
    expect(profitText({ price: 30, laborCost: 45, profit: -15 })).toBe("Labor $45 · Profit -$15");
  });

  it("says minutes are missing when labor cannot be worked out, and nothing when there is no price", () => {
    expect(profitText({ price: 40, laborCost: null, profit: null })).toBe("Labor minutes not set");
    expect(profitText({ price: null, laborCost: null, profit: null })).toBe("");
  });

  it("marks only a quote that loses money", () => {
    expect(underCostText({ underCost: true, profit: -15 })).toBe("Under labor cost by $15");
    expect(underCostText({ underCost: false, profit: 5 })).toBeNull();
    expect(underCostText({ underCost: false, profit: null })).toBeNull();
  });
});
