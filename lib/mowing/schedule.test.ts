import { describe, expect, it } from "vitest";
import { dueOnDate, dueThisWeek } from "./schedule";

describe("mowing schedule", () => {
  it("weekly is always due; biweekly alternates from the anchor week", () => {
    expect(dueThisWeek("weekly", "2026-05-04", "2026-05-12")).toBe(true);
    expect(dueThisWeek("biweekly", "2026-05-04", "2026-05-06")).toBe(true); // same week
    expect(dueThisWeek("biweekly", "2026-05-04", "2026-05-13")).toBe(false); // next week
    expect(dueThisWeek("biweekly", "2026-05-04", "2026-05-20")).toBe(true); // two weeks on
    expect(dueThisWeek("biweekly", "2026-05-07", "2026-04-23")).toBe(true); // two weeks before
  });

  it("respects the preferred day, skips inactive and already-cut customers", () => {
    const c = { frequency: "weekly" as const, anchor_date: "2026-05-04", preferred_day: 3, active: true }; // Wednesday
    expect(dueOnDate(c, "2026-05-06", false)).toBe(true); // Wed
    expect(dueOnDate(c, "2026-05-07", false)).toBe(false); // Thu
    expect(dueOnDate({ ...c, preferred_day: null }, "2026-05-07", false)).toBe(true);
    expect(dueOnDate(c, "2026-05-06", true)).toBe(false);
    expect(dueOnDate({ ...c, active: false }, "2026-05-06", false)).toBe(false);
  });
});

describe("mowing season", () => {
  it("nothing is due outside the season dates", async () => {
    const { inSeason, dueOnDate } = await import("./schedule");
    const season = { season_start: "2026-04-01", season_end: "2026-11-30" };
    expect(inSeason(season, "2026-03-31")).toBe(false);
    expect(inSeason(season, "2026-04-01")).toBe(true);
    expect(inSeason(season, "2026-12-01")).toBe(false);
    expect(inSeason({ season_start: null, season_end: null }, "2026-01-15")).toBe(true);
    const c = { frequency: "weekly" as const, anchor_date: "2026-04-06", preferred_day: null, active: true };
    expect(dueOnDate(c, "2026-12-02", false, season)).toBe(false);
    expect(dueOnDate(c, "2026-06-02", false, season)).toBe(true);
  });
});
