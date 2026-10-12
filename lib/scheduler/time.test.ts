import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDayLabel,
  formatDuration,
  formatTimeRange,
  localDate,
  localTime,
  parseHHMM,
  tzOffsetMinutes,
  weekStart,
  weekdayOf,
  zonedToUtc,
} from "./time";

describe("time helpers (America/New_York)", () => {
  it("converts local wall time to UTC in EDT and EST", () => {
    expect(zonedToUtc("2026-10-14", "09:00").toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00").toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtc("2026-10-14", "24:00").toISOString()).toBe("2026-10-15T04:00:00.000Z");
  });

  it("handles the spring-forward gap and the fall-back repeat", () => {
    // Mar 8 2026: 2:00 EST jumps to 3:00 EDT.
    expect(zonedToUtc("2026-03-08", "01:30").toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(zonedToUtc("2026-03-08", "03:00").toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(zonedToUtc("2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z"); // moves forward
    expect(zonedToUtc("2026-03-08", "09:00").toISOString()).toBe("2026-03-08T13:00:00.000Z");
    // Nov 1 2026: 2:00 EDT falls back to 1:00 EST. 1:30 happens twice; we take the first.
    expect(zonedToUtc("2026-11-01", "01:30").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedToUtc("2026-11-01", "09:00").toISOString()).toBe("2026-11-01T14:00:00.000Z");
    // That day is 25 hours long.
    const len = zonedToUtc("2026-11-02", "00:00").getTime() - zonedToUtc("2026-11-01", "00:00").getTime();
    expect(len / 3_600_000).toBe(25);
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"))).toBe(-300);
  });

  it("round-trips UTC back to local date and time", () => {
    const d = new Date("2026-10-15T03:30:00Z"); // 11:30pm Oct 14 local
    expect(localDate(d)).toBe("2026-10-14");
    expect(localTime(d)).toBe("23:30");
  });

  it("parses Postgres-style times", () => {
    expect(parseHHMM("09:00")).toBe(540);
    expect(parseHHMM("9:30")).toBe(570);
    expect(parseHHMM("17:00:00")).toBe(1020);
    expect(() => parseHHMM("25:00")).toThrow();
  });

  it("does calendar math and Mon–Sun weeks", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week before
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
  });

  it("formats labels for reason strings", () => {
    const s = zonedToUtc("2026-10-13", "09:00");
    expect(formatDayLabel(s)).toBe("Tue Oct 13");
    expect(formatTimeRange(s, zonedToUtc("2026-10-13", "10:30"))).toBe("9:00–10:30am");
    expect(formatTimeRange(zonedToUtc("2026-10-13", "11:30"), zonedToUtc("2026-10-13", "13:00"))).toBe("11:30am–1:00pm");
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(45)).toBe("45m");
  });
});
