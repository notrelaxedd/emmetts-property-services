import { describe, expect, it } from "vitest";
import { boundsDraftFrom, boundsSummary, parseBounds, parseTierDraft, parseWeights, pricePlaceholder, tierDraftFrom, weightsDraftFrom } from "./tier-form";
import { DEFAULT_PRICE_TIERS, DEFAULT_SCORE_WEIGHTS, DEFAULT_TIER_BOUNDS } from "./types";

describe("tier table drafts", () => {
  it("turns nulls into blank cells and numbers into text", () => {
    const d = tierDraftFrom(DEFAULT_PRICE_TIERS);
    expect(d.leaf_cleanup).toEqual({ small: "30", medium: "40", large: "50", xl: "" });
    expect(d.mow).toEqual({ small: "", medium: "", large: "", xl: "" });
  });

  it("round-trips the defaults", () => {
    const r = parseTierDraft(tierDraftFrom(DEFAULT_PRICE_TIERS), "price");
    expect(r).toEqual({ ok: true, table: DEFAULT_PRICE_TIERS });
  });

  it("sends a cleared cell as null so the server clears it", () => {
    const d = tierDraftFrom(DEFAULT_PRICE_TIERS);
    d.leaf_cleanup.medium = "  ";
    const r = parseTierDraft(d, "price");
    expect(r.ok && r.table.leaf_cleanup.medium).toBeNull();
  });

  it("rejects junk and negatives with the cell named", () => {
    const d = tierDraftFrom(DEFAULT_PRICE_TIERS);
    d.mow.large = "abc";
    expect(parseTierDraft(d, "price")).toEqual({ ok: false, error: "Mowing Large price must be a number of 0 or more" });
    d.mow.large = "-5";
    expect(parseTierDraft(d, "price").ok).toBe(false);
  });

  it("shows [OWNER_TO_FILL] for blank prices and Quote on site for XL", () => {
    expect(pricePlaceholder("small")).toBe("[OWNER_TO_FILL]");
    expect(pricePlaceholder("xl")).toBe("Quote on site");
  });
});

describe("bounds and weights", () => {
  it("accepts ascending bounds", () => {
    expect(parseBounds(boundsDraftFrom(DEFAULT_TIER_BOUNDS))).toEqual({ ok: true, bounds: DEFAULT_TIER_BOUNDS });
  });

  it("rejects bounds that do not ascend or are blank", () => {
    expect(parseBounds({ small_max: "8000", medium_max: "4000", large_max: "12000" }).ok).toBe(false);
    expect(parseBounds({ small_max: "", medium_max: "4000", large_max: "12000" }).ok).toBe(false);
  });

  it("describes the tiers", () => {
    expect(boundsSummary(DEFAULT_TIER_BOUNDS)).toBe("Small up to 4,000, medium up to 8,000, large up to 12,000, XL above");
  });

  it("reads weights between 0 and 10", () => {
    expect(parseWeights(weightsDraftFrom(DEFAULT_SCORE_WEIGHTS))).toEqual({ ok: true, weights: DEFAULT_SCORE_WEIGHTS });
    expect(parseWeights({ ...weightsDraftFrom(DEFAULT_SCORE_WEIGHTS), lawn: "11" }).ok).toBe(false);
    expect(parseWeights({ ...weightsDraftFrom(DEFAULT_SCORE_WEIGHTS), customer: "" }).ok).toBe(false);
    expect(parseWeights({ ...weightsDraftFrom(DEFAULT_SCORE_WEIGHTS), owner: "0" }).ok).toBe(true);
  });
});
