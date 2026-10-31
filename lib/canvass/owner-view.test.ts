import { describe, expect, it } from "vitest";
import { filterRows, incomeLabel, occupancyLabel, parseHomeParams, topList } from "./owner-view";
import type { TopRow } from "./owner-view";

const NOW = new Date("2026-10-31T18:20:00Z"); // 2:20pm Ohio (EDT)

const row = (id: string, over: Partial<TopRow> = {}): TopRow => ({
  id,
  scorePoints: 6,
  scoreBreakdown: { lawn: 2 },
  fullAddress: `${id} Main St`,
  do_not_knock: false,
  lastKnockAt: null,
  ...over,
});

const opts = (ids: string[], over = {}) => ({
  hideDnk: true,
  hideRecent: true,
  recencyDays: 14,
  singleFamily: true,
  singleFamilyIds: new Set(ids),
  now: NOW,
  ...over,
});

describe("parseHomeParams", () => {
  it("defaults to all three filters on", () => {
    expect(parseHomeParams({})).toEqual({ hideDnk: true, hideRecent: true, singleFamily: true });
  });

  it("turns a filter off with 0", () => {
    expect(parseHomeParams({ dnk: "0", sf: ["0"] })).toEqual({ hideDnk: false, hideRecent: true, singleFamily: false });
  });

  it("ignores old slot links (date / start / end) and junk values", () => {
    expect(parseHomeParams({ date: "2026-11-02", start: "16:00", end: "18:00", recent: "nope" })).toEqual({ hideDnk: true, hideRecent: true, singleFamily: true });
  });
});

describe("topList", () => {
  it("ranks by points, then the bigger lawn tier, then address", () => {
    const rows = [
      row("a", { scorePoints: 5, scoreBreakdown: { lawn: 1 } }),
      row("b", { scorePoints: 9 }),
      row("c", { scorePoints: 5, scoreBreakdown: { lawn: 3 } }),
      row("d", { scorePoints: 5, scoreBreakdown: { lawn: 3 }, fullAddress: "1 Main St" }),
    ];
    const { top } = topList(rows, opts(["a", "b", "c", "d"]));
    expect(top.map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("hides do-not-knock, recently knocked and non single-family houses by default", () => {
    const rows = [
      row("dnk", { do_not_knock: true }),
      row("recent", { lastKnockAt: "2026-10-25T12:00:00Z" }),
      row("old", { lastKnockAt: "2026-09-01T12:00:00Z" }),
      row("duplex"),
      row("ok"),
    ];
    const ids = ["dnk", "recent", "old", "ok"];
    expect(filterRows(rows, opts(ids)).map((r) => r.id).sort()).toEqual(["ok", "old"]);
  });

  it("shows everything with the filters off", () => {
    const rows = [row("dnk", { do_not_knock: true }), row("recent", { lastKnockAt: "2026-10-30T12:00:00Z" }), row("duplex")];
    expect(filterRows(rows, opts([], { hideDnk: false, hideRecent: false, singleFamily: false }))).toHaveLength(3);
  });

  it("caps at 25 and counts the rest", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`h${i}`, { scorePoints: i % 10 }));
    const r = topList(rows, opts(rows.map((x) => x.id)));
    expect(r.top).toHaveLength(25);
    expect(r.moreMatching).toBe(5);
  });
});

describe("labels", () => {
  it("occupancy follows the score's rental rule", () => {
    expect(occupancyLabel(true, false)).toBe("Owner-occupied");
    expect(occupancyLabel(false, false)).toBe("Rental");
    expect(occupancyLabel(true, true)).toBe("Rental");
    expect(occupancyLabel(null, false)).toBe("Unknown");
  });

  it("formats the area income or says it is not available", () => {
    expect(incomeLabel(74200)).toBe("$74,200");
    expect(incomeLabel(null)).toBe("not available");
  });
});
