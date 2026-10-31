import { describe, expect, it } from "vitest";
import type { LearnedWindow } from "./windows";
import type { TimeWindow, WindowResult } from "./types";
import { knockNow, lightAt, nextGreenBlock, plainWindow, weekStrip } from "./lights";

const range = (days: TimeWindow["days"], start: number, end: number): TimeWindow => ({ kind: "range", days, start, end });
const anytime = (days: TimeWindow["days"]): TimeWindow => ({ kind: "anytime", days });

// 2026-10-28 is a Wednesday; EDT (UTC-4) until Sunday 2026-11-01 02:00.
const WED_10 = new Date("2026-10-28T14:00:00Z"); // Wed 10:00
const WED_1630 = new Date("2026-10-28T20:30:00Z"); // Wed 4:30pm
const WED_17 = new Date("2026-10-28T21:00:00Z"); // Wed 5:00pm
const WED_21 = new Date("2026-10-29T01:00:00Z"); // Wed 9:00pm
const SAT_10 = new Date("2026-10-31T14:00:00Z"); // Sat 10:00
const SAT_17 = new Date("2026-10-31T21:00:00Z"); // Sat 5:00pm (EDT)

const wr = (over: Partial<WindowResult>): WindowResult => ({ window: range("weekdays", 17, 19), label: "x", source: "none", reason: "", ...over });

describe("knockNow", () => {
  const evenings = range("weekdays", 17, 19);

  it("is green inside the window and has no next time", () => {
    const k = knockNow(evenings, new Date("2026-10-28T21:30:00Z"));
    expect(k).toEqual({ light: "green", label: "Good now", nextGoodTime: null, nextGoodAt: null });
    expect(knockNow(evenings, WED_17).light).toBe("green"); // start is inclusive
    expect(knockNow(evenings, new Date("2026-10-28T23:00:00Z")).light).toBe("yellow"); // 7:00pm: end is exclusive
  });

  it("is red at 10am and says it is today at 5pm", () => {
    const k = knockNow(evenings, WED_10);
    expect(k.light).toBe("red");
    expect(k.label).toBe("Probably not home");
    expect(k.nextGoodTime).toBe("today 5pm");
    expect(k.nextGoodAt).toBe("2026-10-28T21:00:00.000Z");
  });

  it("is yellow within an hour before or after", () => {
    expect(knockNow(evenings, WED_1630)).toMatchObject({ light: "yellow", label: "Maybe", nextGoodTime: "today 5pm" });
    expect(knockNow(evenings, new Date("2026-10-28T23:59:00Z")).light).toBe("yellow"); // 7:59pm: within 1h after the 7pm end
    expect(knockNow(evenings, new Date("2026-10-29T00:00:00Z")).light).toBe("red"); // 8:00pm: a full hour after
    expect(knockNow(evenings, new Date("2026-10-29T00:30:00Z")).light).toBe("red"); // 8:30pm
    expect(knockNow(evenings, WED_21).light).toBe("red"); // 9pm: more than an hour after
    expect(knockNow(evenings, new Date("2026-10-28T19:59:00Z")).light).toBe("red"); // 3:59pm
  });

  it("points at tomorrow or a later weekday when today is over or does not match", () => {
    expect(knockNow(evenings, WED_21).nextGoodTime).toBe("tomorrow 5pm");
    // Saturday: weekdays-only window, next is Monday (2 days away -> weekday name)
    const sat = knockNow(evenings, SAT_10);
    expect(sat.light).toBe("red");
    expect(sat.nextGoodTime).toBe("Monday 5pm");
    expect(sat.nextGoodAt).toBe("2026-11-02T22:00:00.000Z"); // Monday 5pm EST = 22:00Z (DST ended)
  });

  it("allows :30 starts", () => {
    const w = range("weekdays", 16.5, 19);
    expect(knockNow(w, WED_10).nextGoodTime).toBe("today 4:30pm");
    expect(knockNow(w, WED_10).nextGoodAt).toBe("2026-10-28T20:30:00.000Z");
    expect(knockNow(w, WED_1630).light).toBe("green");
    expect(knockNow(w, new Date("2026-10-28T20:29:00Z")).light).toBe("yellow");
  });

  it("is DST-safe: tomorrow's 9am after the clocks go back", () => {
    // Saturday 5pm EDT -> Sunday 9am is EST (UTC-5) = 14:00Z
    const w = range("weekends", 9, 12);
    const k = knockNow(w, new Date("2026-10-31T22:00:00Z"));
    expect(k.nextGoodTime).toBe("tomorrow 9am");
    expect(k.nextGoodAt).toBe("2026-11-01T14:00:00.000Z");
  });

  it("treats a weekday-anytime window as green 9am-8pm on weekdays", () => {
    const w = anytime("weekdays");
    expect(knockNow(w, WED_10).light).toBe("green");
    expect(knockNow(w, new Date("2026-10-28T12:00:00Z")).light).toBe("yellow"); // 8am, within an hour before
    expect(knockNow(w, new Date("2026-10-28T10:00:00Z")).light).toBe("red"); // 6am
    expect(knockNow(w, new Date("2026-10-28T10:00:00Z")).nextGoodTime).toBe("today 9am");
  });

  it("makes anytime on the wrong kind of day yellow, with the next good day", () => {
    const k = knockNow(anytime("weekdays"), SAT_10);
    expect(k.light).toBe("yellow");
    expect(k.nextGoodTime).toBe("Monday 9am");
    expect(knockNow(anytime("weekdays"), new Date("2026-10-31T10:00:00Z")).light).toBe("red"); // Sat 6am
    expect(knockNow(anytime("any"), SAT_10).light).toBe("green");
  });

  it("makes a range on the wrong kind of day red", () => {
    expect(knockNow(range("weekends", 9, 12), WED_10).light).toBe("red");
    expect(knockNow(range("weekends", 9, 12), WED_10).nextGoodTime).toBe("Saturday 9am");
  });

  it("turns a red hour yellow when the learned bucket is 0.25..0.45", () => {
    const learned = (mean: number): LearnedWindow =>
      ({
        window: range("weekdays", 17, 19),
        reason: "",
        knocks: 20,
        best: {} as never,
        buckets: { "weekdays:10": { days: "weekdays", start: 10, end: 12, knocks: 8, answers: 3, alpha0: 1, beta0: 3, mean, isPrior: false } },
      }) as LearnedWindow;
    const w = range("weekdays", 17, 19);
    expect(knockNow(w, WED_10, "America/New_York", learned(0.3)).light).toBe("yellow");
    expect(knockNow(w, WED_10, "America/New_York", learned(0.25)).light).toBe("yellow");
    expect(knockNow(w, WED_10, "America/New_York", learned(0.2)).light).toBe("red");
    expect(knockNow(w, WED_10, "America/New_York", learned(0.45)).light).toBe("red");
    expect(knockNow(w, WED_10, "America/New_York", null).light).toBe("red");
    // learned never downgrades a green hour
    expect(knockNow(w, WED_17, "America/New_York", learned(0.3)).light).toBe("green");
  });
});

describe("lightAt", () => {
  it("uses whole-hour blocks", () => {
    const w = range("weekdays", 17, 19);
    expect([15, 16, 17, 18, 19, 20].map((h) => lightAt(w, 3, h))).toEqual(["red", "yellow", "green", "green", "yellow", "red"]);
  });
  it("counts a block as green when the window overlaps it", () => {
    expect(lightAt(range("weekdays", 16.5, 19), 3, 16)).toBe("green");
  });
});

describe("nextGreenBlock", () => {
  it("skips the block you are inside", () => {
    expect(nextGreenBlock(range("weekdays", 17, 19), WED_17)?.label).toBe("tomorrow 5pm");
  });
  it("names Saturday for a Saturday window", () => {
    expect(nextGreenBlock(range("weekends", 9, 17), WED_10)?.label).toBe("Saturday 9am");
  });
  it("rolls a finished weekend window to Sunday", () => {
    expect(nextGreenBlock(range("weekends", 9, 12), SAT_17)?.label).toBe("tomorrow 9am");
    expect(nextGreenBlock(range("any", 9, 12), SAT_17)?.label).toBe("tomorrow 9am");
  });
  it("finds Monday from Friday evening for weekdays-only", () => {
    expect(nextGreenBlock(range("weekdays", 17, 19), new Date("2026-10-30T23:00:00Z"))?.label).toBe("Monday 5pm");
  });
});

describe("plainWindow", () => {
  const bg = { pct_not_in_lf: 0.2, pct_hh_nonworking_parent: 0.1, depart_dist: {}, commute_dist: { "Less than 5 minutes": 1, "20 to 24 minutes": 10, "25 to 29 minutes": 40, "30 to 34 minutes": 5 } };
  const noParcel = { callback_window: null, home_pattern: null };

  it("ACS return-home: weekdays after the window start, Saturdays all day, commute reason", () => {
    const p = plainWindow(wr({ source: "acs", window: range("weekdays", 16, 18) }), bg, noParcel);
    expect(p.text).toBe("Weekdays after 4pm, Saturdays all day");
    expect(p.reason).toMatch(/^most people here commute ~\d+ min to day jobs\.$/);
    expect(p.reason).not.toMatch(/%/);
  });
  it("ACS return-home without commute data still reads plainly", () => {
    const p = plainWindow(wr({ source: "acs", window: range("weekdays", 16.5, 18.5) }), null, noParcel);
    expect(p.text).toBe("Weekdays after 4:30pm, Saturdays all day");
    expect(p.reason).toBe("most people here work away from home during the day.");
  });
  it("ACS daytime-friendly", () => {
    const p = plainWindow(wr({ source: "acs", window: range("weekdays", 10, 16) }), bg, noParcel);
    expect(p).toEqual({ text: "Good anytime weekdays", reason: "lots of households here have someone home during the day." });
    expect(plainWindow(wr({ source: "acs", window: anytime("weekdays") }), bg, noParcel).text).toBe("Good anytime weekdays");
  });
  it("homeowner words win and are kept", () => {
    const p = plainWindow(wr({ source: "homeowner" }), bg, { callback_window: "come back after 5 on weekdays", home_pattern: null });
    expect(p.text).toBe("Homeowner said: come back after 5 on weekdays.");
    const q = plainWindow(wr({ source: "homeowner" }), bg, { callback_window: " Try Saturdays. ", home_pattern: null });
    expect(q.text).toBe("Homeowner said: Try Saturdays.");
  });
  it("crew tags", () => {
    expect(plainWindow(wr({ source: "crew" }), bg, { callback_window: null, home_pattern: "evenings_only" }).text).toBe("Crew noted: evenings only.");
    expect(plainWindow(wr({ source: "crew" }), bg, { callback_window: null, home_pattern: "weekends_only" }).text).toBe("Crew noted: weekends only.");
    expect(plainWindow(wr({ source: "crew" }), bg, { callback_window: null, home_pattern: "home_weekdays" }).text).toBe("Crew noted: home on weekdays.");
  });
  it("learned", () => {
    const p = plainWindow(wr({ source: "learned", window: range("weekdays", 18, 20) }), bg, noParcel);
    expect(p).toEqual({ text: "Weekdays 6–8pm", reason: "that's when doors on this block have opened for us." });
  });
  it("none", () => {
    const p = plainWindow(wr({ source: "none", window: range("weekdays", 17, 19) }), null, noParcel);
    expect(p).toEqual({ text: "Weekdays 5–7pm (default)", reason: "no area data yet." });
  });
  it("do not knock", () => {
    expect(plainWindow(wr({ source: "none", label: "Do not knock" }), null, noParcel).text).toBe("Do not knock");
  });
});

describe("weekStrip", () => {
  const strip = weekStrip(range("weekdays", 17, 19), null);

  it("is Mon..Sun with weekday hours 14..20 and weekend hours 9..20", () => {
    expect(strip.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(strip[0].blocks.map((b) => b.hour)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(strip[5].blocks.map((b) => b.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(strip[6].blocks).toHaveLength(12);
  });
  it("colours only (no numbers)", () => {
    expect(strip[0].blocks.map((b) => b.light)).toEqual(["red", "red", "yellow", "green", "green", "yellow", "red"]);
    expect(strip[5].blocks.every((b) => b.light === "red")).toBe(true);
    for (const d of strip) for (const b of d.blocks) expect(Object.keys(b).sort()).toEqual(["hour", "light"]);
  });
  it("shows an anytime-weekdays window as yellow on the weekend", () => {
    const s = weekStrip(anytime("weekdays"), null);
    expect(s[0].blocks.find((b) => b.hour === 14)?.light).toBe("green");
    expect(s[5].blocks.find((b) => b.hour === 14)?.light).toBe("yellow");
    expect(s[5].blocks.find((b) => b.hour === 9)?.light).toBe("yellow");
  });
  it("applies the learned yellow band", () => {
    const learned = {
      window: range("weekdays", 17, 19),
      reason: "",
      knocks: 20,
      best: {} as never,
      buckets: { "weekends:10": { days: "weekends", start: 10, end: 12, knocks: 8, answers: 3, alpha0: 1, beta0: 3, mean: 0.3, isPrior: false } },
    } as LearnedWindow;
    const s = weekStrip(range("weekdays", 17, 19), learned);
    expect(s[5].blocks.find((b) => b.hour === 10)?.light).toBe("yellow");
    expect(s[5].blocks.find((b) => b.hour === 11)?.light).toBe("yellow"); // same 10-12 bucket
    expect(s[5].blocks.find((b) => b.hour === 12)?.light).toBe("red");
  });
});
