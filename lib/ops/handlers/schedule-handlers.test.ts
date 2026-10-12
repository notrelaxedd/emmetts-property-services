/**
 * Approval handlers that feed the scheduler: drop, crew_change, weather_hold and the booking
 * rejection. (Kept apart from handlers.test.ts, which mocks email / AI / Stripe for the
 * customer-facing handlers.)
 */
import { describe, expect, it, vi } from "vitest";
import { approvalRow, fakeDb, jobRow } from "../test-utils";
import { crew_changeHandler } from "./crew_change";
import { dropHandler } from "./drop";
import { rejectBooking } from "./reject";
import { weather_holdHandler } from "./weather_hold";

const ctx = { siteUrl: "https://example.test", actor: "owner" };
const T = "2026-01-01T00:00:00.000Z";
const asg = (id: string, job_id: string, crew_id: string, status: string) =>
  ({ id, created_at: T, updated_at: T, job_id, crew_id, status, responded_at: null, swap_to_crew_id: null }) as never;
const slot = { start_at: "2026-10-20T13:00:00.000Z", end_at: "2026-10-20T15:00:00.000Z" };
const rows = (db: ReturnType<typeof fakeDb>, jobId: string) =>
  db.tables.job_assignments.filter((a) => a.job_id === jobId).map((a) => [a.crew_id, a.status]);

describe("dropHandler (approved drop inside the notice window)", () => {
  it("drops the requester but keeps the booked job, its slot and the other crew; marks it for cover", async () => {
    const db = fakeDb({
      jobs: [jobRow({ id: "j1", status: "booked", crew_size: 2, ...slot })],
      job_assignments: [asg("a1", "j1", "A", "drop_requested"), asg("a2", "j1", "B", "accepted")],
    });
    await dropHandler(db, approvalRow({ kind: "drop", ref_table: "job_assignments", ref_id: "a1", status: "approved", payload: { assignment_id: "a1", job_id: "j1" } }), ctx);
    expect(db.tables.jobs[0]).toMatchObject({ status: "booked", ...slot, resolve_reason: "drop" });
    expect(rows(db, "j1")).toEqual([["A", "dropped"], ["B", "accepted"]]);
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "drop_approved", job_ids: ["j1"] });
  });
});

describe("crew_changeHandler (approved time off)", () => {
  it("approves the exception and takes the crew member off overlapping jobs, which keep their slots", async () => {
    const db = fakeDb({
      crew_exceptions: [
        { id: "x1", created_at: T, updated_at: T, crew_id: "A", kind: "off", status: "pending", date_from: "2026-10-20", date_to: "2026-10-20", start_time: null, end_time: null, note: null },
      ] as never,
      jobs: [
        jobRow({ id: "j1", status: "booked", crew_size: 2, ...slot }),
        jobRow({ id: "j2", status: "booked", start_at: "2026-10-22T13:00:00.000Z", end_at: "2026-10-22T14:00:00.000Z" }),
      ],
      job_assignments: [asg("a1", "j1", "A", "accepted"), asg("a2", "j1", "B", "accepted"), asg("a3", "j2", "A", "accepted")],
    });
    await crew_changeHandler(db, approvalRow({ kind: "crew_change", ref_table: "crew_exceptions", ref_id: "x1", status: "approved", payload: { crew_exception_id: "x1" } }), ctx);
    expect(db.tables.crew_exceptions[0].status).toBe("approved");
    expect(rows(db, "j1")).toEqual([["A", "dropped"], ["B", "accepted"]]);
    expect(db.tables.jobs[0]).toMatchObject({ status: "booked", ...slot, resolve_reason: "crew_change" });
    expect(rows(db, "j2")).toEqual([["A", "accepted"]]);
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "crew_change", job_ids: ["j1"] });
  });
});

describe("weather_holdHandler", () => {
  it("holds the jobs and marks them for re-planning", async () => {
    const db = fakeDb({ jobs: [jobRow({ id: "j1", status: "booked", ...slot })] });
    await weather_holdHandler(db, approvalRow({ kind: "weather_hold", ref_table: "jobs", ref_id: "j1", status: "approved", payload: { job_ids: ["j1"] } }), ctx);
    expect(db.tables.jobs[0]).toMatchObject({ weather_hold: true, resolve_reason: "weather_hold", status: "booked" });
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "weather_hold", job_ids: ["j1"] });
  });
});

describe("rejectBooking", () => {
  it("unschedules a proposed job, frees the crew, and puts it on owner hold so sweeps don't re-propose it", async () => {
    const db = fakeDb({
      jobs: [jobRow({ id: "j1", status: "crew_confirmed", resolve_reason: "drop", ...slot })],
      job_assignments: [asg("a1", "j1", "A", "accepted"), asg("a2", "j1", "B", "swap_offered")],
    });
    await rejectBooking(db, approvalRow({ kind: "booking", ref_table: "jobs", ref_id: "j1", status: "rejected", payload: { job_id: "j1" } }), ctx);
    expect(db.tables.jobs[0]).toMatchObject({ status: "unscheduled", start_at: null, owner_hold: true, resolve_reason: null });
    expect(rows(db, "j1")).toEqual([["A", "dropped"]]);
  });
  it("is a no-op for the scheduler's informational cards (unschedulable / needs_cover)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const flag of ["unschedulable", "needs_cover"]) {
      const db = fakeDb({ jobs: [jobRow({ id: "j1", status: "proposed", ...slot })], job_assignments: [asg("a1", "j1", "A", "accepted")] });
      await rejectBooking(db, approvalRow({ kind: "booking", ref_table: "jobs", ref_id: "j1", status: "rejected", payload: { job_id: "j1", [flag]: true } }), ctx);
      expect(db.tables.jobs[0]).toMatchObject({ status: "proposed", ...slot, owner_hold: false });
      expect(rows(db, "j1")).toEqual([["A", "accepted"]]);
    }
  });
});
