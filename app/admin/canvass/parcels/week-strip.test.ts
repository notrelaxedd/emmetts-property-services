import { describe, expect, it } from "vitest";
import { cellLabel, cellLight, stripHours } from "@/components/admin/canvass/week-strip";
import type { StripDay } from "@/lib/canvass/lights";

const weekday = (day: StripDay["day"]): StripDay => ({ day, blocks: [14, 15, 16].map((hour) => ({ hour, light: hour === 16 ? "green" : "yellow" })) });
const weekend = (day: StripDay["day"]): StripDay => ({ day, blocks: [9, 10, 14].map((hour) => ({ hour, light: "red" })) });
const STRIP: StripDay[] = [weekday(1), weekday(2), weekday(3), weekday(4), weekday(5), weekend(6), weekend(0)];

describe("week strip helpers", () => {
  it("rows are the union of every day's hours, earliest first", () => {
    expect(stripHours(STRIP)).toEqual([9, 10, 14, 15, 16]);
    expect(stripHours([])).toEqual([]);
  });

  it("finds a cell's light, or null where a day has no block", () => {
    expect(cellLight(STRIP, 0, 16)).toBe("green");
    expect(cellLight(STRIP, 0, 9)).toBeNull();
    expect(cellLight(STRIP, 5, 9)).toBe("red");
    expect(cellLight(STRIP, 9, 9)).toBeNull();
  });

  it("describes a cell in words for screen readers", () => {
    expect(cellLabel(0, 16, "green")).toBe("Monday 4pm: Good now");
    expect(cellLabel(6, 9, "red")).toBe("Sunday 9am: Probably not home");
  });
});
