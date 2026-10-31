import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEASON_MAP,
  SEASON_LABELS,
  currentSeasonFocus,
  defaultSeasonMap,
  monthIn,
  normalizeMonth,
  seasonFocus,
  seasonService,
} from "./season";
import { SERVICE_KEYS } from "./types";

describe("default season map", () => {
  it("is Sep–Nov leaf cleanup, Dec–Mar snow, Apr–Aug mowing", () => {
    expect(defaultSeasonMap).toBe(DEFAULT_SEASON_MAP);
    for (const m of [9, 10, 11]) expect(DEFAULT_SEASON_MAP[String(m)]).toBe("leaf_cleanup");
    for (const m of [12, 1, 2, 3]) expect(DEFAULT_SEASON_MAP[String(m)]).toBe("snow");
    for (const m of [4, 5, 6, 7, 8]) expect(DEFAULT_SEASON_MAP[String(m)]).toBe("mow");
    expect(Object.keys(DEFAULT_SEASON_MAP).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("seasonFocus", () => {
  it("gives service, label, a one-line pitch and default offer copy", () => {
    expect(seasonFocus(10)).toEqual({
      service: "leaf_cleanup",
      label: "Leaf cleanup",
      pitch: expect.stringMatching(/leaves/i),
      offer: expect.stringMatching(/leaf cleanup/i),
    });
    expect(seasonFocus(1).label).toBe("Snow removal + spring mowing pre-sale");
    expect(seasonFocus(6).label).toBe("Mowing & edging");
    for (const service of SERVICE_KEYS) {
      const f = seasonFocus(1, { "1": service });
      expect(f.service).toBe(service);
      expect(f.label).toBe(SEASON_LABELS[service]);
      expect(f.pitch.length).toBeGreaterThan(20);
      expect(f.pitch).not.toContain("\n");
      expect(f.offer.length).toBeGreaterThan(10);
    }
  });

  it("honours the owner's map and falls back to the default for missing / unknown months", () => {
    expect(seasonService(9, { ...DEFAULT_SEASON_MAP, "9": "mow" })).toBe("mow");
    expect(seasonService(9, { "9": "gutters" })).toBe("gutters");
    expect(seasonService(9, {})).toBe("leaf_cleanup");
    expect(seasonService(9, { "9": "pressure_wash" as never })).toBe("leaf_cleanup");
    expect(seasonService(9, null)).toBe("leaf_cleanup");
    expect(seasonService(9, undefined)).toBe("leaf_cleanup");
  });

  it("wraps odd month numbers instead of throwing", () => {
    expect(normalizeMonth(13)).toBe(1);
    expect(normalizeMonth(0)).toBe(12);
    expect(normalizeMonth(-1)).toBe(11);
    expect(normalizeMonth(Number.NaN)).toBe(1);
    expect(normalizeMonth(6.4)).toBe(6);
    expect(seasonService(13)).toBe("snow");
  });

  it("reads the current month in Ohio time", () => {
    // 2026-10-31T03:30Z is still Oct 30, 11:30pm in New York.
    expect(monthIn(new Date("2026-10-31T03:30:00Z"))).toBe(10);
    // 2026-11-01T03:30Z is Oct 31, 11:30pm in New York.
    expect(monthIn(new Date("2026-11-01T03:30:00Z"))).toBe(10);
    expect(monthIn(new Date("2026-11-01T05:30:00Z"))).toBe(11);
    expect(currentSeasonFocus(undefined, new Date("2026-12-15T12:00:00Z")).service).toBe("snow");
    expect(currentSeasonFocus({ "12": "gutters" }, new Date("2026-12-15T12:00:00Z")).service).toBe("gutters");
  });
});
