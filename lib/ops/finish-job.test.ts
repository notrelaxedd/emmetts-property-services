import { describe, expect, it } from "vitest";
import { finishJob } from "./index";
import { fakeDb, jobRow } from "./test-utils";

describe("finishJob", () => {
  it("books → done with hours, one payout per accepted crew member, and the review follow-up", async () => {
    const job = jobRow({ status: "booked" });
    const db = fakeDb({
      jobs: [job],
      job_assignments: [
        { id: "a1", job_id: job.id, crew_id: "c1", status: "accepted" },
        { id: "a2", job_id: job.id, crew_id: "c2", status: "declined" },
      ],
      profiles: [{ id: "c1", hourly_rate: 20 }],
    });
    const now = new Date("2026-10-30T15:00:00Z");
    expect(await finishJob(db, job.id, { hours: 2.5, actor: "owner@x", now })).toBe(true);
    expect(db.tables.jobs[0]).toMatchObject({ status: "done", actual_minutes: 150 });
    expect(db.tables.jobs[0].completed_at).toBeTruthy();
    expect(db.tables.payouts).toEqual([expect.objectContaining({ crew_id: "c1", job_id: job.id, hours: 2.5, rate: 20, amount: 50, paid_cash_at: null })]);
    expect(db.tables.fleet_tasks).toEqual([
      expect.objectContaining({ type: "followup_review", dedupe_key: `review:${job.id}`, run_after: "2026-10-31T15:00:00.000Z" }),
    ]);
  });

  it("does not pay anyone twice and reports a job that is already done", async () => {
    const job = jobRow({ status: "in_progress" });
    const db = fakeDb({
      jobs: [job],
      job_assignments: [{ id: "a1", job_id: job.id, crew_id: "c1", status: "accepted" }],
      payouts: [{ id: "p1", job_id: job.id, crew_id: "c1", amount: 10 }],
      profiles: [{ id: "c1", hourly_rate: 20 }],
    });
    expect(await finishJob(db, job.id, { hours: 1, actor: "t" })).toBe(true);
    expect(db.tables.payouts).toHaveLength(1);
    expect(await finishJob(db, job.id, { hours: 1, actor: "t" })).toBe(false);
  });

  it("refuses a job that isn't on", async () => {
    const job = jobRow({ status: "proposed" });
    await expect(finishJob(fakeDb({ jobs: [job] }), job.id, { hours: 1, actor: "t" })).rejects.toThrow(/that's on/);
  });
});
