import { describe, expect, it } from "vitest";
import {
  NOW,
  assignment,
  at,
  block,
  crew,
  crewException,
  input,
  job,
  ownerException,
  ownerWindow,
  weekdays,
  OWNER_MON_FRI,
} from "./fixtures";
import { findCover, isInsideNoticeWindow, orderJobs, solve } from "./solve";

const MON = "2026-10-12";
const TUE = "2026-10-13";
const THU = "2026-10-15";

const kevin = crew("k", "Kevin Ames");
const chase = crew("c", "Chase Bell");

// Rocky River, OH-ish coordinates.
const SMITH = { lat: 41.4756, lng: -81.8396, preferred_days: [], name: "Ann Smith" };
const NEXT_DOOR = { lat: 41.4766, lng: -81.8396, preferred_days: [] }; // ~0.07 mi north
const FAR_AWAY = { lat: 41.75, lng: -81.8396, preferred_days: [] }; // ~19 mi north

describe("solve: basics", () => {
  it("proposes the earliest slot with a readable reason", () => {
    const res = solve(input({ jobs: [job("j1")], crew: [kevin], crewAvailability: weekdays("k") }));
    expect(res.unschedulable).toEqual([]);
    expect(res.proposals).toEqual([
      {
        job_id: "j1",
        start_at: at(MON, "08:00"),
        end_at: at(MON, "09:00"),
        crew_ids: ["k"],
        reason: "Mon Oct 12 8:00–9:00am, Kevin. Earliest open slot.",
      },
    ]);
  });

  it("never starts sooner than now + 2h, on the 30-minute grid", () => {
    const now = new Date(at(MON, "09:10"));
    const res = solve(input({ now, jobs: [job("j1")], crew: [kevin], crewAvailability: weekdays("k") }));
    expect(res.proposals[0].start_at).toBe(at(MON, "11:30"));
  });

  it("proposals consume capacity: two 1-crew jobs with one crew member can't share a slot", () => {
    const res = solve(
      input({ jobs: [job("a"), job("b", { paid_at: "2026-10-02T12:00:00Z" })], crew: [kevin], crewAvailability: weekdays("k") }),
    );
    expect(res.proposals.map((p) => [p.job_id, p.start_at])).toEqual([
      ["a", at(MON, "08:00")],
      ["b", at(MON, "09:00")],
    ]);
  });

  it("needs crew_size people free for the whole job and picks that many", () => {
    const res = solve(
      input({
        jobs: [job("j", { crew_size: 2, est_minutes: 90 })],
        crew: [kevin, chase],
        crewAvailability: [...weekdays("k"), ...weekdays("c", "10:00", "17:00")],
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(MON, "10:00"));
    expect(res.proposals[0].crew_ids.sort()).toEqual(["c", "k"]);
    expect(res.proposals[0].reason).toMatch(/^Mon Oct 12 10:00–11:30am, (Chase \+ Kevin|Kevin \+ Chase)\./);
  });

  it("split day: a 2 h job waits for the afternoon block instead of straddling lunch", () => {
    const res = solve(
      input({
        jobs: [job("j", { est_minutes: 120 })],
        crew: [kevin],
        crewAvailability: [block("k", 1, "08:00", "11:30"), block("k", 1, "12:30", "17:00")],
        existingAssignments: [assignment("k", "x", at(MON, "08:00"), at(MON, "10:00"))],
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(MON, "12:30"));
    expect(res.proposals[0].end_at).toBe(at(MON, "14:30"));
  });

  it("overlapping blocks merge so a job can span them", () => {
    const res = solve(
      input({
        jobs: [job("j", { est_minutes: 300 })],
        crew: [kevin],
        crewAvailability: [block("k", 1, "08:00", "12:00"), block("k", 1, "11:00", "15:00")],
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(MON, "08:00"));
    expect(res.proposals[0].end_at).toBe(at(MON, "13:00"));
  });
});

describe("solve: ordering", () => {
  it("orders by paid_at (nulls last), then deadline, then created_at", () => {
    const jobs = [
      job("unpaid", { paid_at: null, created_at: "2026-01-01T00:00:00Z" }),
      job("paid-late", { paid_at: "2026-10-05T00:00:00Z" }),
      job("paid-early", { paid_at: "2026-10-01T00:00:00Z", created_at: "2026-09-30T00:00:00Z" }),
      job("paid-early-deadline", { paid_at: "2026-10-01T00:00:00Z", deadline: "2026-10-20" }),
      job("unpaid-old", { paid_at: null, created_at: "2025-01-01T00:00:00Z" }),
    ];
    expect(orderJobs(jobs).map((j) => j.id)).toEqual(["paid-early-deadline", "paid-early", "paid-late", "unpaid-old", "unpaid"]);
  });

  it("the earlier-paid job gets the earlier slot even if created later", () => {
    const res = solve(
      input({
        jobs: [
          job("created-first", { est_minutes: 540, paid_at: "2026-10-09T00:00:00Z", created_at: "2026-09-01T00:00:00Z" }),
          job("paid-first", { est_minutes: 540, paid_at: "2026-10-02T00:00:00Z", created_at: "2026-10-01T00:00:00Z" }),
        ],
        crew: [kevin],
        crewAvailability: weekdays("k"),
      }),
    );
    const byId = Object.fromEntries(res.proposals.map((p) => [p.job_id, p.start_at]));
    expect(byId["paid-first"]).toBe(at(MON, "08:00"));
    expect(byId["created-first"]).toBe(at(TUE, "08:00"));
  });
});

describe("solve: crew rules", () => {
  it("max-hours cap excludes a crew member", () => {
    const k = crew("k", "Kevin", { max_hours_week: 10 });
    const existing = [assignment("k", "x", at(TUE, "08:00"), at(TUE, "17:00"))]; // 9 h this week
    const only = solve(input({ jobs: [job("j", { est_minutes: 120 })], crew: [k], crewAvailability: weekdays("k"), existingAssignments: existing }));
    expect(only.proposals[0].start_at).toBe(at("2026-10-19", "08:00")); // next week

    // With Chase around (more hours than Kevin but under his cap) Chase gets it this week.
    const busyChase = [assignment("c", "y", at(THU, "08:00"), at(THU, "17:00")), assignment("c", "z", at("2026-10-16", "08:00"), at("2026-10-16", "17:00"))];
    const both = solve(
      input({
        jobs: [job("j", { est_minutes: 120 })],
        crew: [k, chase],
        crewAvailability: [...weekdays("k"), ...weekdays("c")],
        existingAssignments: [...existing, ...busyChase],
      }),
    );
    expect(both.proposals[0].crew_ids).toEqual(["c"]);
    expect(both.proposals[0].start_at).toBe(at(MON, "08:00"));
  });

  it("explains when only hour caps block a job", () => {
    const k = crew("k", "Kevin", { max_hours_week: 1 });
    const res = solve(input({ jobs: [job("j", { est_minutes: 120 })], crew: [k], crewAvailability: weekdays("k") }));
    expect(res.proposals).toEqual([]);
    expect(res.unschedulable[0].reason).toMatch(/weekly hour caps/);
  });

  it("paused crew are never offered new jobs, but their existing assignments still block", () => {
    const pat = crew("p", "Pat", { paused: true });
    const res = solve(
      input({
        jobs: [job("solo"), job("pair", { crew_size: 2 })],
        crew: [kevin, pat],
        crewAvailability: [...weekdays("k"), ...weekdays("p")],
        existingAssignments: [assignment("p", "x", at(MON, "08:00"), at(MON, "12:00"))],
      }),
    );
    expect(res.proposals.map((p) => p.crew_ids)).toEqual([["k"]]);
    expect(res.unschedulable).toEqual([{ job_id: "pair", reason: "Needs 2 crew but only 1 can take new jobs." }]);

    // Pat's job is still a commitment: he can't cover a slot that overlaps it even if unpaused.
    const unpaused = { ...pat, paused: false };
    const cover = findCover({
      ...input({ crew: [kevin, unpaused], crewAvailability: [...weekdays("k"), ...weekdays("p")] }),
      existingAssignments: [assignment("p", "x", at(MON, "08:00"), at(MON, "12:00")), assignment("k", "y", at(MON, "10:00"), at(MON, "11:00"))],
      job: { id: "y", start_at: at(MON, "10:00"), end_at: at(MON, "11:00"), est_minutes: 60 },
      declinedCrewId: "k",
    });
    expect(cover).toBeNull();
  });

  it("approved time off removes a day; pending time off does not", () => {
    const base = { jobs: [job("j")], crew: [kevin], crewAvailability: weekdays("k") };
    expect(solve(input({ ...base, crewExceptions: [crewException("k", MON)] })).proposals[0].start_at).toBe(at(TUE, "08:00"));
    expect(solve(input({ ...base, crewExceptions: [crewException("k", MON, { status: "pending" })] })).proposals[0].start_at).toBe(
      at(MON, "08:00"),
    );
    const partial = crewException("k", MON, { start_time: "08:00", end_time: "12:00" });
    expect(solve(input({ ...base, crewExceptions: [partial] })).proposals[0].start_at).toBe(at(MON, "12:00"));
  });

  it("an extra day adds capacity on a normally-off day", () => {
    const owner = [...OWNER_MON_FRI, ownerWindow(6, "08:00", "14:00")]; // owner works Saturdays
    const base = { jobs: [job("j")], crew: [kevin], ownerWindows: owner, crewAvailability: [block("k", 3, "08:00", "17:00")] };
    expect(solve(input(base)).proposals[0].start_at).toBe(at("2026-10-14", "08:00")); // Wednesday
    const extraMon = crewException("k", MON, { kind: "extra", start_time: "09:00", end_time: "13:00" });
    expect(solve(input({ ...base, crewExceptions: [extraMon] })).proposals[0].start_at).toBe(at(MON, "09:00"));
    // Whole-day extra on a Saturday is bounded by the owner's hours.
    const now = new Date(at(THU, "08:00"));
    const extraSat = crewException("k", "2026-10-17", { kind: "extra" });
    expect(solve(input({ ...base, now, crewExceptions: [extraSat] })).proposals[0].start_at).toBe(at("2026-10-17", "08:00"));
  });

  it("an owner exception closes a day (or narrows it)", () => {
    const base = { jobs: [job("j")], crew: [kevin], crewAvailability: weekdays("k") };
    expect(solve(input({ ...base, ownerExceptions: [ownerException(MON)] })).proposals[0].start_at).toBe(at(TUE, "08:00"));
    const narrow = ownerException(MON, { closed: false, start_time: "13:00", end_time: "15:00" });
    expect(solve(input({ ...base, ownerExceptions: [narrow] })).proposals[0].start_at).toBe(at(MON, "13:00"));
    expect(solve(input({ ...base, closedDates: [MON] })).proposals[0].start_at).toBe(at(TUE, "08:00"));
  });

  it("fairness: the crew member with the fewest hours that week gets the job", () => {
    const res = solve(
      input({
        jobs: [job("j")],
        crew: [kevin, chase],
        crewAvailability: [...weekdays("k"), ...weekdays("c")],
        existingAssignments: [assignment("k", "x", at("2026-10-16", "08:00"), at("2026-10-16", "13:00"))],
      }),
    );
    expect(res.proposals[0].crew_ids).toEqual(["c"]);
    expect(res.proposals[0].reason).toBe("Mon Oct 12 8:00–9:00am, Chase. Earliest open slot; Chase has the fewest hours this week.");
  });
});

describe("solve: preferences", () => {
  it("preferred day wins over an earlier non-preferred slot within the same week", () => {
    const res = solve(
      input({
        jobs: [job("j", { customer_id: "cu" })],
        crew: [kevin],
        crewAvailability: weekdays("k"),
        customers: { cu: { lat: null, lng: null, preferred_days: [4] } }, // Thursday
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(THU, "08:00"));
    expect(res.proposals[0].reason).toBe("Thu Oct 15 8:00–9:00am, Kevin. Preferred day.");
  });

  it("tie-break window: a preferred day more than 7 days past the earliest slot does not win", () => {
    // Kevin never works Wednesdays except an extra day on Wed Oct 21 (9 days after Mon Oct 12).
    const avail = ([1, 2, 4, 5] as const).map((d) => block("k", d, "08:00", "17:00"));
    const res = solve(
      input({
        jobs: [job("j", { customer_id: "cu" })],
        crew: [kevin],
        crewAvailability: avail,
        crewExceptions: [crewException("k", "2026-10-21", { kind: "extra" })],
        customers: { cu: { lat: null, lng: null, preferred_days: [3] } },
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(MON, "08:00"));
    expect(res.proposals[0].reason).toContain("No preferred day open within a week");
  });

  it("proximity bonus: back to back with a job within 3 miles beats the earliest slot", () => {
    const existing = [assignment("c", "smith-job", at(MON, "08:00"), at(MON, "10:00"), { customer_id: "smith" })];
    const run = (where: typeof NEXT_DOOR) =>
      solve(
        input({
          jobs: [job("j", { customer_id: "me" })],
          crew: [kevin, chase],
          crewAvailability: [...weekdays("k"), ...weekdays("c")],
          existingAssignments: existing,
          customers: { smith: SMITH, me: where },
        }),
      ).proposals[0];
    const near = run(NEXT_DOOR);
    expect(near.start_at).toBe(at(MON, "10:00"));
    expect(near.reason).toMatch(/next door to the Smith job/i);
    const far = run(FAR_AWAY);
    expect(far.start_at).toBe(at(MON, "08:00"));
  });

  it("preferred day outranks proximity", () => {
    const res = solve(
      input({
        jobs: [job("j", { customer_id: "me" })],
        crew: [kevin, chase],
        crewAvailability: [...weekdays("k"), ...weekdays("c")],
        existingAssignments: [assignment("c", "smith-job", at(MON, "08:00"), at(MON, "10:00"), { customer_id: "smith" })],
        customers: { smith: SMITH, me: { ...NEXT_DOOR, preferred_days: [2] } },
      }),
    );
    expect(res.proposals[0].start_at).toBe(at(TUE, "08:00"));
  });

  it("proposals made earlier in the run count for proximity too", () => {
    const res = solve(
      input({
        jobs: [job("a", { customer_id: "smith", est_minutes: 120 }), job("b", { customer_id: "me", paid_at: "2026-10-03T00:00:00Z" })],
        crew: [kevin, chase],
        crewAvailability: [...weekdays("k"), ...weekdays("c")],
        customers: { smith: SMITH, me: NEXT_DOOR },
      }),
    );
    const b = res.proposals.find((p) => p.job_id === "b")!;
    expect(b.start_at).toBe(at(MON, "10:00"));
    expect(b.reason).toMatch(/next door to the Smith job/i);
  });

  it("respects a deadline, and says so when nothing fits before it", () => {
    const base = { crew: [kevin], crewAvailability: weekdays("k"), ownerExceptions: [ownerException(MON)] };
    const res = solve(input({ ...base, jobs: [job("j", { deadline: MON })] }));
    expect(res.proposals[0].start_at).toBe(at(TUE, "08:00"));
    expect(res.proposals[0].reason).toContain("After the deadline");
  });

  it("reports jobs with no slot in the horizon", () => {
    const res = solve(input({ jobs: [job("j", { est_minutes: 600 })], crew: [kevin], crewAvailability: weekdays("k") }));
    expect(res.unschedulable).toEqual([
      { job_id: "j", reason: "No 10h slot in the next 21 days where a crew member is free inside open hours." },
    ]);
  });
});

describe("findCover", () => {
  const dana = crew("d", "Dana Cole");
  const eli = crew("e", "Eli Diaz");
  const fred = crew("f", "Fred Ewing");
  const slot = { id: "j", start_at: at(TUE, "09:00"), end_at: at(TUE, "11:00"), est_minutes: 120 };
  const onJob = [assignment("k", "j", slot.start_at, slot.end_at, { status: "declined" }), assignment("c", "j", slot.start_at, slot.end_at)];

  it("returns a free crew member for the same window", () => {
    const res = findCover({
      ...input({
        crew: [kevin, chase, dana, eli, fred],
        crewAvailability: [...weekdays("k"), ...weekdays("c"), ...weekdays("d"), ...weekdays("e"), ...weekdays("f")],
      }),
      existingAssignments: [
        ...onJob,
        assignment("e", "other", at("2026-10-14", "10:00"), at("2026-10-14", "12:00")), // Eli free but has hours
        assignment("f", "clash", at(TUE, "10:00"), at(TUE, "12:00")), // Fred busy at that time
      ],
      job: slot,
      declinedCrewId: "k",
    });
    expect(res).toEqual({ crew_id: "d", reason: "Dana is free Tue Oct 13 9:00–11:00am and has the fewest hours this week." });
  });

  it("returns null when nobody else can cover", () => {
    const res = findCover({
      ...input({
        crew: [kevin, chase, dana],
        crewAvailability: [...weekdays("k"), ...weekdays("c"), ...weekdays("d")],
        crewExceptions: [crewException("d", TUE, { start_time: "10:00", end_time: "12:00" })],
      }),
      existingAssignments: onJob,
      job: slot,
      declinedCrewId: "k",
    });
    expect(res).toBeNull();
  });
});

describe("isInsideNoticeWindow", () => {
  const settings = { drop_notice_hours: 48 };
  it("is true when the job starts sooner than the notice period", () => {
    expect(isInsideNoticeWindow({ start_at: new Date(NOW.getTime() + 24 * 3600e3).toISOString() }, NOW, settings)).toBe(true);
    expect(isInsideNoticeWindow({ start_at: new Date(NOW.getTime() + 47.9 * 3600e3).toISOString() }, NOW, settings)).toBe(true);
  });
  it("is false when there is enough notice or no start time", () => {
    expect(isInsideNoticeWindow({ start_at: new Date(NOW.getTime() + 72 * 3600e3).toISOString() }, NOW, settings)).toBe(false);
    expect(isInsideNoticeWindow({ start_at: new Date(NOW.getTime() + 48 * 3600e3).toISOString() }, NOW, settings)).toBe(false);
    expect(isInsideNoticeWindow({ start_at: null }, NOW, settings)).toBe(false);
  });
});
