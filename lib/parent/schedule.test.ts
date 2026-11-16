import { describe, expect, it } from "vitest";
import { buildParentWeek, type ParentJobInput } from "./schedule";

const days = ["2026-11-16", "2026-11-17"];
const job = (o: Partial<ParentJobInput> = {}): ParentJobInput => ({
  start_at: "2026-11-16T15:00:00.000Z", // 10:00am EST
  end_at: "2026-11-16T16:30:00.000Z",
  est_minutes: 90,
  status: "booked",
  weather_hold: false,
  address: "123 Lake Rd, Rocky River",
  services: ["Leaf cleanup"],
  ...o,
});

describe("buildParentWeek", () => {
  it("keeps every day, puts entries on their local day, in start order", () => {
    const week = buildParentWeek(days, {
      jobs: [job({ start_at: "2026-11-16T19:00:00.000Z", end_at: "2026-11-16T20:00:00.000Z" }), job()],
      mowRoutes: [],
      snowRoutes: [],
    });
    expect(week.map((d) => d.date)).toEqual(days);
    expect(week[0].entries.map((e) => e.start)).toEqual(["2026-11-16T15:00:00.000Z", "2026-11-16T19:00:00.000Z"]);
    expect(week[1].entries).toEqual([]);
  });

  it("uses the local date, not UTC (9pm EST Monday is still Monday)", () => {
    const week = buildParentWeek(days, { jobs: [job({ start_at: "2026-11-17T02:00:00.000Z", end_at: "2026-11-17T03:00:00.000Z" })], mowRoutes: [], snowRoutes: [] });
    expect(week[0].entries).toHaveLength(1);
  });

  it("drops cancelled / unscheduled jobs and labels tentative, held and done ones", () => {
    const week = buildParentWeek(days, {
      jobs: [
        job({ status: "cancelled" }),
        job({ status: "unscheduled" }),
        job({ status: "proposed" }),
        job({ weather_hold: true }),
        job({ status: "done" }),
        job(),
      ],
      mowRoutes: [],
      snowRoutes: [],
    });
    expect(week[0].entries.map((e) => e.note)).toEqual(["Tentative", "Weather hold", "Done", null]);
  });

  it("only carries time, address and service — nothing else", () => {
    const [e] = buildParentWeek(days, { jobs: [job()], mowRoutes: [], snowRoutes: [] })[0].entries;
    expect(e).toEqual({
      kind: "job",
      title: "Leaf cleanup",
      start: "2026-11-16T15:00:00.000Z",
      end: "2026-11-16T16:30:00.000Z",
      places: [{ address: "123 Lake Rd, Rocky River", start: null, end: null }],
      note: null,
    });
  });

  it("turns a route into one entry with its stops in order", () => {
    const week = buildParentWeek(days, {
      jobs: [],
      mowRoutes: [],
      snowRoutes: [
        {
          start_at: "2026-11-17T09:30:00.000Z",
          finish_at: "2026-11-17T11:30:00.000Z",
          stops: [
            { address: "2 B St", arrive_at: "2026-11-17T10:30:00.000Z", done_at: "2026-11-17T10:45:00.000Z" },
            { address: null, arrive_at: "2026-11-17T10:00:00.000Z", done_at: "2026-11-17T10:15:00.000Z" },
          ],
        },
      ],
    });
    const [e] = week[1].entries;
    expect(e.title).toBe("Snow route");
    expect(e.places.map((p) => p.address)).toEqual(["Address not on file", "2 B St"]);
  });

  it("falls back to the estimate when a job has no end time", () => {
    const [e] = buildParentWeek(days, { jobs: [job({ end_at: null, est_minutes: 60 })], mowRoutes: [], snowRoutes: [] })[0].entries;
    expect(e.end).toBe("2026-11-16T16:00:00.000Z");
  });
});
