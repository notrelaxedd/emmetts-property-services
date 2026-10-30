import { describe, expect, it } from "vitest";
import {
  FLAT_CONVERT_RATE,
  convertProbability,
  featureRate,
  fitConvertModel,
  houseDistance,
  houseNumber,
  lotBand,
  neighborBoost,
  priorityScore,
  scoreQuintile,
  streetOf,
} from "./score";
import type { ConvertRow } from "./score";

const row = (over: Partial<ConvertRow>): ConvertRow => ({
  outcome: "not_interested",
  lotBand: "mid",
  ownerOccupied: true,
  nearCustomer: false,
  street: "ELM RD",
  knockerId: "k1",
  pitchId: "p1",
  ...over,
});

describe("lotBand", () => {
  it("bands by square feet", () => {
    expect(lotBand(5999)).toBe("small");
    expect(lotBand(6000)).toBe("mid");
    expect(lotBand(12000)).toBe("mid");
    expect(lotBand(12001)).toBe("large");
    expect(lotBand(null)).toBeNull();
    expect(lotBand(Number.NaN)).toBeNull();
  });
});

describe("fitConvertModel / convertProbability", () => {
  it("starts flat at 8% with no data", () => {
    const m = fitConvertModel([]);
    expect(m.base).toBe(FLAT_CONVERT_RATE);
    expect(convertProbability({ lotBand: "large", street: "ELM RD" }, m)).toBeCloseTo(0.08, 10);
    expect(convertProbability({}, m)).toBeCloseTo(0.08, 10);
  });
  it("smooths per-feature rates with k = 5 toward the base", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row({ outcome: "booked", street: "OAK AVE" })),
      ...Array.from({ length: 10 }, () => row({ outcome: "no_answer", street: "ELM RD" })),
    ];
    const m = fitConvertModel(rows);
    expect(m.n).toBe(20);
    expect(m.converts).toBe(10);
    // base = (10 + 5 * 0.08) / (20 + 5)
    expect(m.base).toBeCloseTo(10.4 / 25, 10);
    expect(featureRate(m, "street", "OAK AVE")).toBeCloseTo((10 + 5 * m.base) / 15, 10);
    expect(featureRate(m, "street", "oak ave")).toBeCloseTo((10 + 5 * m.base) / 15, 10);
    expect(featureRate(m, "street", "ELM RD")).toBeCloseTo((0 + 5 * m.base) / 15, 10);
    expect(featureRate(m, "street", "MAPLE")).toBe(m.base);
    expect(featureRate(m, "street", null)).toBe(m.base);
  });
  it("moves the probability up for good streets and down for bad ones, within 1–60%", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row({ outcome: "booked", street: "OAK AVE" })),
      ...Array.from({ length: 10 }, () => row({ outcome: "quote_given", street: "OAK AVE" })),
      ...Array.from({ length: 40 }, () => row({ outcome: "no_answer", street: "ELM RD", ownerOccupied: false })),
    ];
    const m = fitConvertModel(rows);
    const oak = convertProbability({ street: "OAK AVE", ownerOccupied: true }, m);
    const elm = convertProbability({ street: "ELM RD", ownerOccupied: false }, m);
    const unknown = convertProbability({ street: "MAPLE" }, m);
    expect(oak).toBeGreaterThan(unknown);
    expect(elm).toBeLessThan(unknown);
    expect(oak).toBeLessThanOrEqual(0.6);
    expect(elm).toBeGreaterThanOrEqual(0.01);
    expect(unknown).toBeCloseTo(m.base, 10);
  });
  it("clamps extreme evidence", () => {
    const rows = Array.from({ length: 200 }, () => row({ outcome: "booked", street: "OAK AVE", knockerId: "ace", pitchId: "gold" }));
    const m = fitConvertModel(rows);
    expect(convertProbability({ street: "OAK AVE", knockerId: "ace", pitchId: "gold", lotBand: "mid", ownerOccupied: true }, m)).toBe(0.6);
    const bad = fitConvertModel(Array.from({ length: 200 }, () => row({ outcome: "no_answer", street: "ELM RD" })));
    expect(convertProbability({ street: "ELM RD", lotBand: "mid", ownerOccupied: true, knockerId: "k1", pitchId: "p1" }, bad)).toBe(0.01);
  });
});

describe("addresses", () => {
  it("parses house numbers and streets", () => {
    expect(houseNumber("1234 Elm Rd")).toBe(1234);
    expect(houseNumber("  42 Oak Ave")).toBe(42);
    expect(houseNumber("Elm Rd")).toBeNull();
    expect(houseNumber(null)).toBeNull();
    expect(streetOf("1234 Elm Rd")).toBe("ELM RD");
    expect(streetOf("1234-36 Elm  Rd")).toBe("ELM RD");
    expect(streetOf("Elm Rd")).toBe("ELM RD");
  });
  it("counts houses on the same side of the street", () => {
    expect(houseDistance(100, 106)).toBe(3);
    expect(houseDistance(100, 101)).toBeNull();
    expect(houseDistance(100, 100)).toBe(0);
    const street = [100, 102, 104, 110, 112].map((n) => ({ address: `${n} Elm Rd` }));
    expect(houseDistance(100, 104, street)).toBe(2);
    expect(houseDistance(100, 110, street)).toBe(3);
    expect(houseDistance(100, 120, street)).toBe(5);
    expect(houseDistance(102, 100, street)).toBe(1);
  });
});

describe("neighborBoost", () => {
  const parcel = { address: "100 Elm Rd", street: "ELM RD", centroid_lat: 41.4756, centroid_lng: -81.8396 };
  it("is 1.5 within N houses on the same street even when coordinates are far", () => {
    const customers = [{ address: "106 Elm Rd", lat: 41.49, lng: -81.9 }];
    expect(neighborBoost(parcel, customers, 3)).toBe(1.5);
    expect(neighborBoost(parcel, customers, 2)).toBe(1);
    expect(neighborBoost(parcel, [{ address: "106 Oak Ave", lat: 41.49, lng: -81.9 }], 3)).toBe(1);
  });
  it("uses the street's parcels to count real houses", () => {
    const street = [100, 102, 110].map((n) => ({ address: `${n} Elm Rd` }));
    const customers = [{ address: "110 Elm Rd", lat: 41.49, lng: -81.9 }];
    expect(neighborBoost(parcel, customers, 3)).toBe(1); // numbers alone: 5 houses apart
    expect(neighborBoost(parcel, customers, 3, street)).toBe(1.5); // really 2 houses apart
  });
  it("falls back to metres: 1.5 within 60 m, 1.2 within 150 m, else 1", () => {
    // ~0.00045 deg lat ~ 50 m; ~0.001 deg lat ~ 111 m; 0.002 ~ 222 m.
    expect(neighborBoost(parcel, [{ lat: 41.4756 + 0.00045, lng: -81.8396 }], 3)).toBe(1.5);
    expect(neighborBoost(parcel, [{ lat: 41.4756 + 0.001, lng: -81.8396 }], 3)).toBe(1.2);
    expect(neighborBoost(parcel, [{ lat: 41.4756 + 0.002, lng: -81.8396 }], 3)).toBe(1);
    expect(neighborBoost(parcel, [{ address: "101 Elm Rd", lat: 41.4756 + 0.0002, lng: -81.8396 }], 3)).toBe(1.5); // across the street
    expect(neighborBoost(parcel, [], 3)).toBe(1);
    expect(neighborBoost({ ...parcel, centroid_lat: null, centroid_lng: null }, [{ lat: 41.4756, lng: -81.8396 }], 3)).toBe(1);
  });
});

describe("priorityScore", () => {
  it("multiplies the four factors and reports them", () => {
    const r = priorityScore({ pAnswer: 0.5, pConvert: 0.1, value: 200, neighborBoost: 1.5 });
    expect(r.score).toBe(15);
    expect(r.breakdown).toEqual({ pAnswer: 0.5, pConvert: 0.1, value: 200, neighborBoost: 1.5 });
    expect(priorityScore({ pAnswer: 2, pConvert: -1, value: 100, neighborBoost: 1 }).score).toBe(0);
  });
});

describe("scoreQuintile", () => {
  it("ranks into 0..4 and is stable under ties", () => {
    expect(scoreQuintile([1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4]);
    expect(scoreQuintile([5, 1, 3, 2, 4, 10, 0, 7, 8, 9])).toEqual([2, 0, 1, 1, 2, 4, 0, 3, 3, 4]);
    expect(scoreQuintile([3, 3, 3])).toEqual([0, 0, 0]);
    expect(scoreQuintile([1, 1, 9])).toEqual([0, 0, 3]);
    expect(scoreQuintile([])).toEqual([]);
    expect(scoreQuintile([7])).toEqual([0]);
  });
});
