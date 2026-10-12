import { describe, expect, it } from "vitest";
import { buildCapacity, canTake, covers, crewAvailableForDay, intersect, merge, ownerOpenForDay, subtract } from "./capacity";
import { NOW, OWNER_MON_FRI, assignment, at, block, crew, crewException, input, ownerException, weekdays } from "./fixtures";
import { zonedToUtc } from "./time";

const t = (date: string, hhmm: string) => zonedToUtc(date, hhmm).getTime();
const iv = (date: string, a: string, b: string) => ({ start: t(date, a), end: t(date, b) });
const D = "2026-10-12"; // Monday

describe("interval helpers", () => {
  it("merges overlapping and touching intervals, drops empties", () => {
    expect(merge([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 10 }, { start: 9, end: 9 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 10 },
    ]);
  });

  it("intersects", () => {
    expect(intersect([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }])).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
    expect(intersect([{ start: 0, end: 5 }], [{ start: 5, end: 9 }])).toEqual([]);
  });

  it("subtracts, splitting blocks", () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 4 }, { start: 6, end: 12 }])).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 20 }])).toEqual([]);
    expect(subtract([{ start: 0, end: 10 }, { start: 20, end: 30 }], [])).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });
});

describe("crew availability", () => {
  it("merges overlapping weekly blocks into one", () => {
    const blocks = [block("k", 1, "08:00", "12:00"), block("k", 1, "10:00", "14:00"), block("k", 1, "14:00", "15:00")];
    expect(crewAvailableForDay("k", D, blocks, [])).toEqual([iv(D, "08:00", "15:00")]);
  });

  it("keeps split days split: a 2 h job cannot straddle the lunch gap", () => {
    const blocks = [block("k", 1, "08:00", "12:00"), block("k", 1, "13:00", "17:00")];
    const avail = crewAvailableForDay("k", D, blocks, []);
    expect(avail).toHaveLength(2);
    expect(covers(avail, t(D, "11:00"), t(D, "13:00"))).toBe(false);
    expect(covers(avail, t(D, "10:00"), t(D, "12:00"))).toBe(true);
    expect(covers(avail, t(D, "13:00"), t(D, "15:00"))).toBe(true);
  });

  it("approved time off removes the day; pending does not; partial off cuts a hole", () => {
    const blocks = weekdays("k");
    expect(crewAvailableForDay("k", D, blocks, [crewException("k", D)])).toEqual([]);
    expect(crewAvailableForDay("k", D, blocks, [crewException("k", D, { status: "pending" })])).toEqual([iv(D, "08:00", "17:00")]);
    expect(crewAvailableForDay("k", D, blocks, [crewException("k", D, { status: "declined" })])).toEqual([iv(D, "08:00", "17:00")]);
    expect(
      crewAvailableForDay("k", D, blocks, [crewException("k", D, { start_time: "10:00", end_time: "12:00" })]),
    ).toEqual([iv(D, "08:00", "10:00"), iv(D, "12:00", "17:00")]);
    // Date ranges are inclusive.
    const range = crewException("k", "2026-10-12", { date_to: "2026-10-14" });
    expect(crewAvailableForDay("k", "2026-10-14", blocks, [range])).toEqual([]);
    expect(crewAvailableForDay("k", "2026-10-15", blocks, [range])).toHaveLength(1);
  });

  it("an approved extra day adds capacity on a normally-off day", () => {
    const sat = "2026-10-17";
    expect(crewAvailableForDay("k", sat, weekdays("k"), [])).toEqual([]);
    expect(
      crewAvailableForDay("k", sat, weekdays("k"), [crewException("k", sat, { kind: "extra", start_time: "09:00", end_time: "13:00" })]),
    ).toEqual([iv(sat, "09:00", "13:00")]);
    expect(crewAvailableForDay("k", sat, weekdays("k"), [crewException("k", sat, { kind: "extra", status: "pending" })])).toEqual([]);
  });
});

describe("owner windows", () => {
  it("uses weekday windows, closes on a closed exception, replaces on a timed exception", () => {
    expect(ownerOpenForDay(D, OWNER_MON_FRI, [])).toEqual([iv(D, "08:00", "17:00")]);
    expect(ownerOpenForDay(D, OWNER_MON_FRI, [ownerException(D)])).toEqual([]);
    expect(
      ownerOpenForDay(D, OWNER_MON_FRI, [ownerException(D, { closed: false, start_time: "12:00", end_time: "15:00" })]),
    ).toEqual([iv(D, "12:00", "15:00")]);
    expect(ownerOpenForDay("2026-10-17", OWNER_MON_FRI, [])).toEqual([]); // Saturday
    expect(ownerOpenForDay(D, OWNER_MON_FRI, [], new Set([D]))).toEqual([]);
  });
});

describe("buildCapacity", () => {
  it("subtracts existing assignments and counts weekly hours (Mon–Sun)", () => {
    const cap = buildCapacity(
      input({
        crew: [crew("k", "Kevin")],
        crewAvailability: weekdays("k"),
        existingAssignments: [
          assignment("k", "x", at(D, "09:00"), at(D, "11:00")),
          assignment("k", "y", at("2026-10-18", "09:00"), at("2026-10-18", "10:00")), // Sunday, same week
          assignment("k", "z", at("2026-10-19", "09:00"), at("2026-10-19", "10:00")), // next week
          assignment("k", "w", at(D, "13:00"), at(D, "14:00"), { status: "declined" }), // ignored
        ],
      }),
    );
    const k = cap.crew.k;
    expect(k.week_minutes).toEqual({ "2026-10-12": 180, "2026-10-19": 60 });
    expect(covers(k.free, t(D, "09:30"), t(D, "10:00"))).toBe(false);
    expect(covers(k.free, t(D, "13:00"), t(D, "14:00"))).toBe(true);
    expect(cap.days[0]).toBe("2026-10-11");
    expect(cap.days).toHaveLength(22);
  });

  it("paused crew get no new capacity, but their existing assignments still block and count", () => {
    const cap = buildCapacity(
      input({
        crew: [crew("p", "Pat", { paused: true })],
        crewAvailability: weekdays("p"),
        existingAssignments: [assignment("p", "x", at(D, "09:00"), at(D, "12:00"))],
      }),
    );
    const p = cap.crew.p;
    expect(p.available).toEqual([]);
    expect(p.busy).toEqual([iv(D, "09:00", "12:00")]);
    expect(p.week_minutes["2026-10-12"]).toBe(180);
    expect(canTake(p, t(D, "13:00"), t(D, "14:00"), 60)).toEqual({ ok: false, why: "paused" });
  });

  it("enforces max_hours_week", () => {
    const cap = buildCapacity(
      input({
        crew: [crew("k", "Kevin", { max_hours_week: 10 })],
        crewAvailability: weekdays("k"),
        existingAssignments: [assignment("k", "x", at("2026-10-13", "08:00"), at("2026-10-13", "17:00"))],
      }),
    );
    expect(canTake(cap.crew.k, t(D, "08:00"), t(D, "09:00"), 60)).toEqual({ ok: true });
    expect(canTake(cap.crew.k, t(D, "08:00"), t(D, "10:00"), 120)).toEqual({ ok: false, why: "hours" });
    // Next week is a fresh 10 hours.
    expect(canTake(cap.crew.k, t("2026-10-19", "08:00"), t("2026-10-19", "10:00"), 120)).toEqual({ ok: true });
  });

  it("ignores assignments on jobs being re-solved", () => {
    const cap = buildCapacity({
      ...input({
        crew: [crew("k", "Kevin")],
        crewAvailability: weekdays("k"),
        existingAssignments: [assignment("k", "x", at(D, "09:00"), at(D, "11:00"))],
      }),
      ignoreJobIds: ["x"],
    });
    expect(cap.crew.k.busy).toEqual([]);
    expect(NOW.toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });
});
