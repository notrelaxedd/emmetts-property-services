import { describe, expect, it } from "vitest";
import {
  callbackWindowText,
  excludeLogged,
  googleMapsWalkUrl,
  greetingFor,
  nextStopIndex,
  priceServiceLabel,
  quoteLine,
  walkProgress,
} from "./walk-links";
import type { WalkStopView } from "./views";

const stop = (id: string, order: number): WalkStopView => ({
  id,
  order,
  fullAddress: `${order} Main St, Rocky River, OH 44116`,
  ownerFirstName: null,
  lat: 41.47,
  lng: -81.84,
  pitch: "p",
  quoteLabel: "$40",
  callback_window: null,
  walkMeters: 10,
});

describe("googleMapsWalkUrl", () => {
  it("builds the walking directions link", () => {
    expect(googleMapsWalkUrl(41.4756, -81.8396)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=41.4756,-81.8396&travelmode=walking",
    );
  });
});

describe("greetingFor", () => {
  it("uses the first name or the homeowner", () => {
    expect(greetingFor("Maria")).toBe("Hi, is Maria home?");
    expect(greetingFor(null)).toBe("Hi, is the homeowner home?");
    expect(greetingFor("  ")).toBe("Hi, is the homeowner home?");
  });
});

describe("quoteLine", () => {
  it("joins a price with the lower-cased service", () => {
    expect(quoteLine("$40", "Leaf cleanup")).toBe("$40 leaf cleanup");
  });
  it("never shows owner-only wording", () => {
    expect(quoteLine("Quote on site", "Leaf cleanup")).toBe("Leaf cleanup: quote on site");
    expect(quoteLine("Owner to fill in", "Leaf cleanup")).toBe("Leaf cleanup: price to be set");
    expect(quoteLine("Lot size unknown", "Leaf cleanup")).toBe("Leaf cleanup: price to be set");
  });
});

describe("walkProgress", () => {
  it("shows the house being worked on and the booked count", () => {
    expect(walkProgress({ total: 25, handled: 7, booked: 2 }).label).toBe("8 of 25 · 2 booked");
    expect(walkProgress({ total: 25, handled: 0, booked: 0 }).label).toBe("1 of 25");
  });
  it("clamps at the end and handles an empty walk", () => {
    const done = walkProgress({ total: 3, handled: 3, booked: 1 });
    expect(done.current).toBe(3);
    expect(done.fraction).toBe(1);
    expect(walkProgress({ total: 0, handled: 0, booked: 0 })).toMatchObject({ current: 0, fraction: 0, label: "0 of 0" });
    expect(walkProgress({ total: 3, handled: 9, booked: 0 }).handled).toBe(3);
  });
});

describe("nextStopIndex", () => {
  const stops = [stop("a", 1), stop("b", 2), stop("c", 3)];
  it("moves forward past done houses", () => {
    expect(nextStopIndex(stops, new Set(["a"]), 0)).toBe(1);
    expect(nextStopIndex(stops, new Set(["a", "b"]), 0)).toBe(2);
  });
  it("wraps back to a skipped house", () => {
    expect(nextStopIndex(stops, new Set(["b", "c"]), 2)).toBe(0);
    expect(nextStopIndex(stops, new Set(["b"]), 2)).toBe(0);
  });
  it("starts at the first house from -1 and ends with null", () => {
    expect(nextStopIndex(stops, new Set(), -1)).toBe(0);
    expect(nextStopIndex(stops, new Set(["a", "b", "c"]), 1)).toBeNull();
    expect(nextStopIndex([], new Set(), -1)).toBeNull();
  });
  it("returns the same house only when it is the last one left", () => {
    expect(nextStopIndex(stops, new Set(["a", "c"]), 1)).toBe(1);
  });
});

describe("excludeLogged", () => {
  it("drops logged houses and renumbers", () => {
    const out = excludeLogged([stop("a", 1), stop("b", 2), stop("c", 3)], new Set(["a", "c"]));
    expect(out.map((s) => [s.id, s.order])).toEqual([["b", 1]]);
  });
});

describe("callbackWindowText", () => {
  it("passes the presets and tidies custom text", () => {
    expect(callbackWindowText("Weekends")).toBe("Weekends");
    expect(callbackWindowText("custom", "  after   6 on Tuesdays ")).toBe("after 6 on Tuesdays");
    expect(callbackWindowText("custom", "   ")).toBeNull();
    expect(callbackWindowText("custom", "x".repeat(300))).toHaveLength(200);
  });
});

describe("priceServiceLabel", () => {
  it("names the one service the price is for, not the season headline", () => {
    expect(quoteLine("$45", priceServiceLabel("snow"))).toBe("$45 snow removal");
    expect(quoteLine("$30", priceServiceLabel("mow"))).toBe("$30 mowing");
    expect(quoteLine("$40", priceServiceLabel("leaf_cleanup"))).toBe("$40 leaf cleanup");
  });
});
