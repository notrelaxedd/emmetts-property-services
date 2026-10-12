import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/scheduler", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/scheduler")>();
  return { ...real, solve: vi.fn(() => ({ proposals: [], unschedulable: [] })) };
});

import type { AssignmentStatus } from "../../lib/db/types";
import type { SchedulerInput } from "../../lib/scheduler";
import { solve } from "../../lib/scheduler";
import { at, crew, job, NOW, OWNER_MON_FRI, weekdays } from "../../lib/scheduler/fixtures";
import { customerRow, settingsRow } from "../../lib/ops/test-utils";
import { fleetDb, makeCtx } from "../test-helpers";
import { runSchedule } from "./schedule";

const T0 = "2026-01-01T00:00:00.000Z";
const assign = (id: string, job_id: string, crew_id: string, status: AssignmentStatus) => ({
  id, created_at: T0, updated_at: T0, job_id, crew_id, status, responded_at: null, swap_to_crew_id: null,
});
const solveMock = vi.mocked(solve);

function seed() {
  return fleetDb({
    settings: [settingsRow({ drop_notice_hours: 24 })],
    profiles: [crew("A", "Ann Lee"), crew("B", "Bo Diaz"), crew("C", "Cy Park")],
    owner_windows: OWNER_MON_FRI,
    owner_exceptions: [
      { id: "oe-old", created_at: T0, updated_at: T0, date: "2026-01-05", closed: true, start_time: null, end_time: null, note: null },
      { id: "oe-new", created_at: T0, updated_at: T0, date: "2026-10-16", closed: true, start_time: null, end_time: null, note: null },
    ],
    crew_availability: [...weekdays("A"), ...weekdays("B"), ...weekdays("C")],
    crew_exceptions: [
      { id: "x1", created_at: T0, updated_at: T0, crew_id: "B", date_from: "2026-10-13", date_to: "2026-10-13", start_time: null, end_time: null, kind: "off", status: "approved", note: null },
      { id: "x2", created_at: T0, updated_at: T0, crew_id: "C", date_from: "2026-10-14", date_to: "2026-10-14", start_time: null, end_time: null, kind: "off", status: "pending", note: null },
    ],
    customers: [
      customerRow({ id: "cust-j1", name: "Pat Smith", lat: 41.47, lng: -81.83 }),
      customerRow({ id: "cust-j2", name: "Lee Wong" }),
      customerRow({ id: "cust-j3", name: "Sam Ortiz" }),
      customerRow({ id: "cust-j4", name: "Kim Ross" }),
      customerRow({ id: "cust-j9", name: "Old Job" }),
    ],
    leads: [
      { id: "l-old", created_at: "2026-01-01T00:00:00Z", updated_at: T0, customer_id: "cust-j1", preferred_days: [5] } as never,
      { id: "l-new", created_at: "2026-09-01T00:00:00Z", updated_at: T0, customer_id: "cust-j1", preferred_days: [1, 3] } as never,
    ],
    jobs: [
      job("j1"),
      job("j2", { status: "proposed", start_at: at("2026-10-12", "09:00"), end_at: at("2026-10-12", "10:00") }),
      job("j3", { status: "booked", start_at: at("2026-10-13", "09:00"), end_at: at("2026-10-13", "10:00") }),
      job("j4", { status: "booked", weather_hold: true, start_at: at("2026-10-14", "13:00"), end_at: at("2026-10-14", "14:00") }),
      job("j9", { status: "booked", start_at: at("2026-10-15", "09:00"), end_at: at("2026-10-15", "11:00"), est_minutes: 120 }),
      job("j0", { status: "done" }),
    ],
    job_assignments: [
      assign("a2", "j2", "A", "offered"),
      assign("a3", "j3", "B", "accepted"),
      assign("a4", "j4", "A", "accepted"),
      assign("a9", "j9", "C", "accepted"),
    ],
  });
}

describe("schedule task", () => {
  beforeEach(() => solveMock.mockReset().mockReturnValue({ proposals: [], unschedulable: [] }));

  it("resets the re-solve set, gathers the input, and writes proposals", async () => {
    const db = seed();
    solveMock.mockReturnValue({
      proposals: [
        { job_id: "j1", start_at: at("2026-10-12", "09:00"), end_at: at("2026-10-12", "10:00"), crew_ids: ["A", "B"], reason: "Earliest slot." },
        { job_id: "j4", start_at: at("2026-10-15", "13:00"), end_at: at("2026-10-15", "14:00"), crew_ids: ["A"], reason: "Rain moved it." },
      ],
      unschedulable: [{ job_id: "j2", reason: "Nobody is free for 3 weeks." }],
    });
    const res = await runSchedule(makeCtx(db, { now: () => NOW, role: "scheduler" }), { reason: "weather_hold", job_ids: ["j2", "j3", "j4", "j0"] });

    // Input: the unscheduled set (j1 + reset j2, j4); booked j3 / done j0 untouched.
    expect(solveMock).toHaveBeenCalledTimes(1);
    const input = solveMock.mock.calls[0][0] as SchedulerInput;
    expect(input.jobs.map((j) => j.id).sort()).toEqual(["j1", "j2", "j4"]);
    expect(input.closedDates).toEqual(["2026-10-14"]); // the weather-held job's day
    expect(input.now).toBe(NOW);
    expect(input.crew.map((c) => c.id)).toEqual(["A", "B", "C"]);
    expect(input.ownerExceptions.map((e) => e.id)).toEqual(["oe-new"]);
    expect(input.crewExceptions.map((e) => e.id)).toEqual(["x1"]); // approved only
    expect(input.crewAvailability).toHaveLength(15);
    expect(input.settings).toEqual({ drop_notice_hours: 24 });
    // Existing assignments: active ones on still-scheduled jobs, with their job times.
    expect(input.existingAssignments.map((a) => [a.id, a.start_at]).sort()).toEqual([
      ["a3", at("2026-10-13", "09:00")],
      ["a9", at("2026-10-15", "09:00")],
    ]);
    expect(input.customers["cust-j1"]).toEqual({ lat: 41.47, lng: -81.83, name: "Pat Smith", preferred_days: [1, 3] });

    const jobs = Object.fromEntries(db.tables.jobs.map((j) => [j.id, j]));
    expect(jobs.j1).toMatchObject({ status: "proposed", start_at: at("2026-10-12", "09:00"), schedule_reason: "Earliest slot." });
    expect(jobs.j4).toMatchObject({ status: "proposed", weather_hold: false, start_at: at("2026-10-15", "13:00") });
    expect(jobs.j2).toMatchObject({ status: "unscheduled", start_at: null });
    expect(jobs.j3).toMatchObject({ status: "booked", start_at: at("2026-10-13", "09:00") });

    const rows = db.tables.job_assignments.map((a) => [a.job_id, a.crew_id, a.status]);
    expect(rows).toContainEqual(["j1", "A", "offered"]);
    expect(rows).toContainEqual(["j1", "B", "offered"]);
    expect(rows).toContainEqual(["j2", "A", "dropped"]);
    expect(rows).toContainEqual(["j3", "B", "accepted"]);
    // (j4, A) is unique: the dropped row is re-offered, not duplicated.
    expect(rows.filter(([j, c]) => j === "j4" && c === "A")).toEqual([["j4", "A", "offered"]]);

    expect(db.tables.approvals).toHaveLength(1);
    expect(db.tables.approvals[0]).toMatchObject({
      kind: "booking", ref_table: "jobs", ref_id: "j2", title: "Can't schedule Lee Wong", summary: "Nobody is free for 3 weeks.",
      payload: { job_id: "j2", unschedulable: true, reason: "Nobody is free for 3 weeks." },
    });
    expect(res).toMatchObject({ reset: 2, considered: 3, proposed: 2, unschedulable: 1, covers: 0, no_cover: 0 });
  });

  it("offers cover when a crew member declines, and asks the owner when nobody fits", async () => {
    const db = seed();
    db.tables.jobs.push(
      job("j5", { customer_id: "cust-j1", status: "booked", crew_size: 2, start_at: at("2026-10-12", "13:00"), end_at: at("2026-10-12", "14:00") }) as never,
      job("j6", { customer_id: "cust-j2", status: "proposed", crew_size: 3, start_at: at("2026-10-13", "13:00"), end_at: at("2026-10-13", "14:00") }) as never,
    );
    db.tables.job_assignments.push(
      assign("a5a", "j5", "A", "accepted"),
      assign("a5b", "j5", "B", "declined"),
      assign("a6a", "j6", "A", "offered"),
      assign("a6c", "j6", "C", "dropped"),
    );
    const res = await runSchedule(makeCtx(db, { now: () => NOW, role: "scheduler" }), { reason: "declined" });

    // j5: B declined → C is the only other free crew member Monday 1pm.
    expect(db.tables.job_assignments.filter((a) => a.job_id === "j5").map((a) => [a.crew_id, a.status])).toEqual([
      ["A", "accepted"], ["B", "declined"], ["C", "offered"],
    ]);
    // j6 needs 3: A offered, C dropped, B is off Tuesday (approved) → no cover.
    const card = db.tables.approvals.find((a) => a.ref_id === "j6")!;
    expect(card).toMatchObject({ kind: "booking", title: "No cover for Lee Wong", payload: { job_id: "j6", needs_cover: true, missing: 2 } });
    expect(res).toMatchObject({ covers: 1, no_cover: 1 });
  });
});
