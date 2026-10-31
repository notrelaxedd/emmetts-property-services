import { describe, expect, it } from "vitest";
import { areaBanner, defaultSlot, filterRows, incomeLabel, occupancyLabel, parseHomeParams, slotLabel, topList } from "./owner-view";
import type { TopRow } from "./owner-view";

const NOW = new Date("2026-10-31T18:20:00Z"); // 2:20pm Ohio (EDT)

const row = (id: string, over: Partial<TopRow> = {}): TopRow => ({
  id,
  scorePoints: 6,
  light: "green",
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
  it("defaults to now with all three filters on", () => {
    expect(parseHomeParams({})).toEqual({ date: null, start: null, end: null, hideDnk: true, hideRecent: true, singleFamily: true });
  });

  it("reads a slot and turns a filter off with 0", () => {
    const p = parseHomeParams({ date: "2026-11-02", start: "16:00", end: "18:00", dnk: "0", sf: ["0"] });
    expect(p).toMatchObject({ date: "2026-11-02", start: "16:00", end: "18:00", hideDnk: false, hideRecent: true, singleFamily: false });
  });

  it("ignores a malformed or half-given slot", () => {
    expect(parseHomeParams({ date: "11/02", start: "16:00" }).date).toBeNull();
    expect(parseHomeParams({ date: "2026-11-02" }).start).toBeNull();
    expect(parseHomeParams({ date: "2026-11-02", start: "25:00" }).date).toBeNull();
    expect(parseHomeParams({ date: "2026-11-02", start: "16:00", end: "nope" }).end).toBeNull();
  });
});

describe("defaultSlot / slotLabel", () => {
  it("rounds now down to the hour for two hours in Ohio time", () => {
    expect(defaultSlot(NOW)).toEqual({ date: "2026-10-31", start: "14:00", end: "16:00" });
  });

  it("caps the end of a late slot", () => {
    expect(defaultSlot(new Date("2026-11-01T02:30:00Z")).end).toBe("23:59"); // 10:30pm Ohio (EDT)
  });

  it("labels a slot with the weekday and a clock time", () => {
    expect(slotLabel("2026-10-31", "16:00")).toBe("Sat 4pm");
    expect(slotLabel("2026-11-02", "16:30")).toBe("Mon 4:30pm");
  });
});

describe("areaBanner", () => {
  it("says it plainly for now and for a slot", () => {
    expect(areaBanner("green", null)).toMatchObject({ emoji: "🟢", text: "Good time to knock now" });
    expect(areaBanner("green", "Sat 4pm").text).toBe("Good time to knock Sat 4pm");
    expect(areaBanner("yellow", null).emoji).toBe("🟡");
    expect(areaBanner("red", null).emoji).toBe("🔴");
  });

  it("copes with an empty area", () => {
    expect(areaBanner(null, null).light).toBeNull();
  });
});

describe("topList", () => {
  it("ranks by points, then green before yellow, then address", () => {
    const rows = [
      row("a", { scorePoints: 5, light: "yellow" }),
      row("b", { scorePoints: 9 }),
      row("c", { scorePoints: 5, light: "green" }),
      row("d", { scorePoints: 5, light: "green", fullAddress: "1 Main St" }),
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
    const rows = Array.from({ length: 30 }, (_, i) => row(`h${i}`, { scorePoints: i % 12 }));
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
