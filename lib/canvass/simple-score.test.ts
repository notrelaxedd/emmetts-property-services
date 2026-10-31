import { describe, expect, it } from "vitest";
import { labelFor, reasonText, scoreColor, scoreLabelText, simpleScore, type SimpleScoreInput } from "./simple-score";

const W = { time: 1, lawn: 1, customer: 1, owner: 1 };
const base: SimpleScoreInput = {
  light: "green",
  tier: "large",
  turfSqft: 9000,
  nearCustomer: "adjacent",
  ownerOccupied: true,
  ownerIsEntity: false,
};

describe("simpleScore points", () => {
  it("is 12 for the best of everything", () => {
    const s = simpleScore(base, W);
    expect(s.points).toBe(12);
    expect(s.max).toBe(12);
    expect(s.label).toBe("hot");
    expect(s.emoji).toBe("🔥");
    expect(s.breakdown).toEqual({ time: 3, lawn: 3, customer: 3, owner: 3 });
  });
  it("time: green 3 / yellow 2 / red 0", () => {
    const b = { ...base, tier: null, nearCustomer: "none" as const, ownerOccupied: false };
    expect(simpleScore({ ...b, light: "green" }, W).breakdown.time).toBe(3);
    expect(simpleScore({ ...b, light: "yellow" }, W).breakdown.time).toBe(2);
    expect(simpleScore({ ...b, light: "red" }, W).breakdown.time).toBe(0);
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
});

describe("labels", () => {
  it("hot >= 9, good 5-8, low <= 4", () => {
    expect([labelFor(12), labelFor(9), labelFor(8), labelFor(5), labelFor(4), labelFor(0)]).toEqual(["hot", "hot", "good", "good", "low", "low"]);
    expect(simpleScore({ ...base, light: "yellow", tier: "medium", nearCustomer: "near", ownerOccupied: true }, W).points).toBe(9);
    expect(simpleScore({ ...base, light: "red", tier: "small", nearCustomer: "none", ownerOccupied: null }, W)).toMatchObject({ points: 2, label: "low", emoji: "➖" });
    expect(simpleScore({ ...base, light: "yellow", tier: "medium", nearCustomer: "street", ownerOccupied: null }, W)).toMatchObject({ points: 6, label: "good", emoji: "👍" });
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
  it("multiply each factor and the total is clamped to 0..12", () => {
    const heavy = { time: 2, lawn: 1, customer: 1, owner: 1 };
    expect(simpleScore(base, heavy).points).toBe(12);
    expect(simpleScore(base, heavy).breakdown.time).toBe(6);
    const none = { time: 0, lawn: 0, customer: 0, owner: 0 };
    expect(simpleScore(base, none).points).toBe(0);
    expect(simpleScore(base, none).label).toBe("low");
  });
  it("a weight of 0 removes a factor; 0.5 halves it and the total rounds", () => {
    const half = { time: 0.5, lawn: 1, customer: 1, owner: 1 };
    const s = simpleScore({ ...base, light: "green" }, half);
    expect(s.breakdown.time).toBe(1.5);
    expect(s.points).toBe(11); // 10.5 rounds up
    const noTime = simpleScore({ ...base, light: "green" }, { ...W, time: 0 });
    expect(noTime.points).toBe(9);
    expect(noTime.reasons).not.toContain("good time now");
  });
  it("ignores nonsense weights", () => {
    expect(simpleScore(base, { time: -1, lawn: 1, customer: 1, owner: 1 }).breakdown.time).toBe(0);
    expect(simpleScore(base, { time: Number.NaN, lawn: 1, customer: 1, owner: 1 }).breakdown.time).toBe(3);
  });
});

describe("reasons", () => {
  it("lists up to three factors, strongest first, in the spec's wording", () => {
    const s = simpleScore(base, W);
    expect(s.reasons).toEqual(["Big lawn", "next to a customer", "good time now"]);
    expect(reasonText(s)).toBe("Big lawn · next to a customer · good time now");
  });
  it("uses the other phrasings", () => {
    expect(simpleScore({ ...base, tier: "medium", nearCustomer: "near", light: "yellow", ownerOccupied: false }, W).reasons).toEqual([
      "Medium lawn", // 2-2-2 tie: lawn, customer, time order
      "near a customer",
      "maybe home now",
    ]);
    expect(simpleScore({ ...base, tier: "small", nearCustomer: "street", light: "red", ownerOccupied: true }, W).reasons).toEqual([
      "owner-occupied",
      "Small lawn",
      "a customer on this street",
    ]);
  });
  it("names rentals last", () => {
    const s = simpleScore({ ...base, light: "red", tier: "large", nearCustomer: "none", ownerOccupied: null, ownerIsEntity: true }, W);
    expect(s.reasons).toEqual(["Big lawn", "Rental (landlord pitch)"]);
  });
  it("has no reasons when nothing scores", () => {
    const s = simpleScore({ light: "red", tier: null, turfSqft: null, nearCustomer: "none", ownerOccupied: false, ownerIsEntity: false }, W);
    expect(s.reasons).toEqual(["Rental (landlord pitch)"]);
    expect(s.points).toBe(1);
  });
});

describe("simpleScore reasons for a chosen slot", () => {
  it("says 'for this slot' instead of 'now' when the light was judged for a slot", () => {
    const b = { ...base, tier: null, nearCustomer: "none" as const, ownerOccupied: null };
    expect(simpleScore({ ...b, light: "green" }, W).reasons).toContain("good time now");
    expect(simpleScore({ ...b, light: "green", forSlot: true }, W).reasons).toContain("good time for this slot");
    expect(simpleScore({ ...b, light: "yellow", forSlot: true }, W).reasons).toContain("maybe home for this slot");
  });
});
