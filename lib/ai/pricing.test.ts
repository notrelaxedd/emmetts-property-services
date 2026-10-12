import { describe, expect, it } from "vitest";
import { estimateCost, lookupPrice, PRICE_TABLE, supportsForcedToolChoice } from "./pricing";

describe("pricing", () => {
  it("computes sonnet 5.5 cost across input, output, cache read and cache write", () => {
    // (1000*2 + 500*10 + 10000*0.2 + 2000*2.5) / 1e6 = 0.014
    const c = estimateCost("claude-sonnet-5-5", {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 2000,
    });
    expect(c.est_cost).toBeCloseTo(0.014, 9);
    expect(c.known).toBe(true);
  });

  it("prices opus 5.5 and treats null token fields as zero", () => {
    const c = estimateCost("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: null });
    expect(c.est_cost).toBe(24);
  });

  it("resolves dated snapshot ids to the family rate", () => {
    expect(lookupPrice("claude-sonnet-4-6-20250929").known).toBe(true);
    expect(lookupPrice("claude-sonnet-4-6-20250929").price).toEqual(PRICE_TABLE["claude-sonnet-4-6"]);
  });

  it("falls back to the sonnet rate and flags unknown models", () => {
    const c = estimateCost("claude-mystery-9", { input_tokens: 1_000_000 });
    expect(c.known).toBe(false);
    expect(c.est_cost).toBe(2);
  });

  it("knows which models reject forced tool_choice", () => {
    expect(supportsForcedToolChoice("claude-sonnet-5-5")).toBe(false);
    expect(supportsForcedToolChoice("claude-opus-5-5")).toBe(false);
    expect(supportsForcedToolChoice("claude-sonnet-4-6")).toBe(true);
    expect(supportsForcedToolChoice("claude-sonnet-5")).toBe(true);
  });
});
