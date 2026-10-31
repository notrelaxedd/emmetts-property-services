import { describe, expect, it } from "vitest";
import { labelFor, reasonText, scoreColor, scoreLabelText, simpleScore, type SimpleScoreInput } from "./simple-score";

const W = { lawn: 1, customer: 1, owner: 1 };
const base: SimpleScoreInput = {
  tier: "large",
  turfSqft: 9000,
  nearCustomer: "adjacent",
  ownerOccupied: true,
  ownerIsEntity: false,
};

describe("simpleScore points", () => {
  it("is 9 for the best of everything", () => {
    const s = simpleScore(base, W);
    expect(s.points).toBe(9);
    expect(s.max).toBe(9);
    expect(s.label).toBe("hot");
    expect(s.emoji).toBe("🔥");
    expect(s.breakdown).toEqual({ lawn: 3, customer: 3, owner: 3 });
  });
  it("lawn: small 1 / medium 2 / large 3 / xl 3 / unknown 1", () => {
    const lawn = (tier: SimpleScoreInput["tier"]) => simpleScore({ ...base, tier }, W).breakdown.lawn;
    expect([lawn("small"), lawn("medium"), lawn("large"), lawn("xl"), lawn(null)]).toEqual([1, 2, 3, 3, 1]);
  });
  it("customer: adjacent 3 / near 2 / street 1 / none 0", () => {
    const c = (nearCustomer: SimpleScoreInput["nearCustomer"]) => simpleScore({ ...base, nearCustomer }, W).breakdown.customer;
    expect([c("adjacent"), c("near"), c("street"), c("none")]).toEqual([3, 2, 1, 0]);
  });
  it("owner: occupied 3 / unknown 1 / rental 0 (entity or not occupied)", () => {
    const o = (ownerOccupied: boolean | null, ownerIsEntity = false) => simpleScore({ ...base, ownerOccupied, ownerIsEntity }, W).breakdown.owner;
    expect([o(true), o(null), o(false), o(null, true), o(true, true)]).toEqual([3, 1, 0, 0, 0]);
  });
  it("has three breakdown factors and no time factor", () => {
    expect(Object.keys(simpleScore(base, W).breakdown).sort()).toEqual(["customer", "lawn", "owner"]);
  });
});

describe("labels", () => {
  it("hot >= 7, good 4-6, low <= 3", () => {
    expect([labelFor(9), labelFor(7), labelFor(6), labelFor(4), labelFor(3), labelFor(0)]).toEqual(["hot", "hot", "good", "good", "low", "low"]);
    expect(simpleScore({ ...base, tier: "medium", nearCustomer: "near", ownerOccupied: true }, W).points).toBe(7);
    expect(simpleScore({ ...base, tier: "small", nearCustomer: "none", ownerOccupied: null }, W)).toMatchObject({ points: 2, label: "low", emoji: "➖" });
    expect(simpleScore({ ...base, tier: "medium", nearCustomer: "street", ownerOccupied: null }, W)).toMatchObject({ points: 4, label: "good", emoji: "👍" });
  });
  it("text and map colours", () => {
    expect(scoreLabelText("hot")).toBe("Hot");
    expect(scoreLabelText("good")).toBe("Good");
    expect(scoreLabelText("low")).toBe("Low");
    expect(scoreColor("hot")).toBe("#65C435");
    expect(scoreColor("good")).toMatch(/^#[0-9A-F]{6}$/);
    expect(scoreColor("low")).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set([scoreColor("hot"), scoreColor("good"), scoreColor("low")]).size).toBe(3);
  });
});

describe("weights", () => {
  it("multiply each factor and the total is clamped to 0..9", () => {
    const heavy = { lawn: 2, customer: 1, owner: 1 };
    expect(simpleScore(base, heavy).points).toBe(9);
    expect(simpleScore(base, heavy).breakdown.lawn).toBe(6);
    const none = { lawn: 0, customer: 0, owner: 0 };
    expect(simpleScore(base, none).points).toBe(0);
    expect(simpleScore(base, none).label).toBe("low");
  });
  it("a weight of 0 removes a factor; 0.5 halves it and the total rounds", () => {
    const half = { lawn: 0.5, customer: 1, owner: 1 };
    const s = simpleScore(base, half);
    expect(s.breakdown.lawn).toBe(1.5);
    expect(s.points).toBe(8); // 7.5 rounds up
    const noLawn = simpleScore(base, { ...W, lawn: 0 });
    expect(noLawn.points).toBe(6);
    expect(noLawn.reasons).not.toContain("Big lawn");
  });
  it("ignores nonsense weights and a stored time key", () => {
    expect(simpleScore(base, { lawn: -1, customer: 1, owner: 1 }).breakdown.lawn).toBe(0);
    expect(simpleScore(base, { lawn: Number.NaN, customer: 1, owner: 1 }).breakdown.lawn).toBe(3);
    const withTime = { time: 5, lawn: 1, customer: 1, owner: 1 } as unknown as typeof W;
    expect(simpleScore(base, withTime).points).toBe(9);
  });
});

describe("reasons", () => {
  it("lists up to three factors, strongest first, in the spec's wording", () => {
    const s = simpleScore(base, W);
    expect(s.reasons).toEqual(["Big lawn", "next to a customer", "owner-occupied"]);
    expect(reasonText(s)).toBe("Big lawn · next to a customer · owner-occupied");
  });
  it("uses the other phrasings", () => {
    expect(simpleScore({ ...base, tier: "medium", nearCustomer: "near", ownerOccupied: null }, W).reasons).toEqual([
      "Medium lawn", // 2-2 tie: lawn, customer order
      "near a customer",
    ]);
    expect(simpleScore({ ...base, tier: "small", nearCustomer: "street", ownerOccupied: true }, W).reasons).toEqual([
      "owner-occupied",
      "Small lawn",
      "a customer on this street",
    ]);
  });
  it("names rentals last", () => {
    const s = simpleScore({ ...base, tier: "large", nearCustomer: "none", ownerOccupied: null, ownerIsEntity: true }, W);
    expect(s.reasons).toEqual(["Big lawn", "Rental (landlord pitch)"]);
  });
  it("has only the rental line when nothing else scores", () => {
    const s = simpleScore({ tier: null, turfSqft: null, nearCustomer: "none", ownerOccupied: false, ownerIsEntity: false }, W);
    expect(s.reasons).toEqual(["Rental (landlord pitch)"]);
    expect(s.points).toBe(1);
  });
});
