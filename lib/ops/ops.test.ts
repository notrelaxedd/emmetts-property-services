import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOPILOT } from "../db/types";
import type { ApprovalKind, AutopilotRules, JobStatus } from "../db/types";
import {
  applyApproval, clearApprovalHandlers, createApproval, createJobFromQuote, decideApproval, enqueueSchedule, ensureJobForQuote,
  enqueueTask, formatPhone, getSettings, isAutopiloted, normalizePhone, pendingCounts, registerApprovalHandler,
  requestApproval, taskRoleFor, transitionJob, updateSettings, upsertCustomer, JOB_TRANSITIONS,
  scheduleTaskKey, tryTransitionJob, releaseCrewFromJob, dropAssignmentKeepSlot, dropCrewFromOverlappingJobs,
  maybeConfirmJob, markForResolve, holdForWeather, clearWeatherHold, setOwnerHold,
} from "./index";
import { approvalRow, customerRow, fakeDb, jobRow, settingsRow } from "./test-utils";

const rules = (over: Partial<AutopilotRules> = {}) => ({ autopilot: { ...structuredClone(DEFAULT_AUTOPILOT), ...over } });
const input = (over = {}) => ({
  kind: "ad" as ApprovalKind, ref_table: "ads", ref_id: "ad-1", payload: { a: 1 },
  title: "Ad", summary: "s", created_by: "ads-w1", ...over,
});

describe("isAutopiloted", () => {
  it("is false for every kind by default", () => {
    for (const k of Object.keys(DEFAULT_AUTOPILOT) as ApprovalKind[]) {
      expect(isAutopiloted(k, { price_total: 1 }, rules())).toBe(false);
    }
    expect(isAutopiloted("ai_cap", {}, rules())).toBe(false);
  });
  it("is true for an enabled simple kind, false for ai_cap always", () => {
    expect(isAutopiloted("followup", {}, rules({ followup: { enabled: true } }))).toBe(true);
    expect(isAutopiloted("ad", {}, rules({ followup: { enabled: true } }))).toBe(false);
    expect(isAutopiloted("ai_cap", {}, rules())).toBe(false);
  });
  it("quote: respects max_total", () => {
    const s = rules({ quote: { enabled: true, max_total: 200 } });
    expect(isAutopiloted("quote", { price_total: 200 }, s)).toBe(true);
    expect(isAutopiloted("quote", { price_total: 199.5 }, s)).toBe(true);
    expect(isAutopiloted("quote", { price_total: 200.01 }, s)).toBe(false);
    expect(isAutopiloted("quote", {}, s)).toBe(false);
    expect(isAutopiloted("quote", { price_total: "50" }, s)).toBe(false);
  });
  it("quote: null max_total means any; disabled means never", () => {
    expect(isAutopiloted("quote", { price_total: 99999 }, rules({ quote: { enabled: true, max_total: null } }))).toBe(true);
    expect(isAutopiloted("quote", { price_total: 1 }, rules({ quote: { enabled: false, max_total: 500 } }))).toBe(false);
  });
});

describe("settings", () => {
  it("fills missing autopilot keys from defaults", async () => {
    const db = fakeDb({ settings: [settingsRow({ autopilot: { quote: { enabled: true } } as unknown as AutopilotRules })] });
    const s = await getSettings(db);
    expect(s.autopilot.quote).toEqual({ enabled: true, max_total: null });
    expect(s.autopilot.drop).toEqual({ enabled: false });
  });
  it("throws if the row is missing", async () => {
    await expect(getSettings(fakeDb())).rejects.toThrow(/missing/);
  });
  it("updateSettings merges autopilot per kind", async () => {
    const db = fakeDb({ settings: [settingsRow({ autopilot: { ...DEFAULT_AUTOPILOT, quote: { enabled: false, max_total: 300 } } })] });
    const s = await updateSettings(db, { default_wage: 18, autopilot: { quote: { enabled: true } } });
    expect(s.default_wage).toBe(18);
    expect(s.autopilot.quote).toEqual({ enabled: true, max_total: 300 });
  });
});

describe("tasks", () => {
  it("taskRoleFor maps types to roles", () => {
    expect(taskRoleFor("quote")).toBe("quotes");
    expect(taskRoleFor("custom_summary")).toBe("quotes");
    expect(taskRoleFor("schedule")).toBe("scheduler");
    expect(taskRoleFor("ad_draft")).toBe("ads");
    for (const t of ["followup_review", "followup_reminder", "weather_watch", "send_message"] as const) {
      expect(taskRoleFor(t)).toBe("followup");
    }
  });
  it("enqueueTask calls the rpc with p_* args and defaults the role", async () => {
    const db = fakeDb();
    const id = await enqueueTask(db, { type: "quote", payload: { lead_id: "l1" }, dedupeKey: "k" });
    expect(db.rpcCalls[0]).toEqual({
      fn: "enqueue_task",
      args: { p_type: "quote", p_role: "quotes", p_payload: { lead_id: "l1" }, p_dedupe_key: "k" },
    });
    expect(db.tables.fleet_tasks[0].id).toBe(id);
  });
  it("enqueueSchedule: sweeps de-dupe per 15-minute bucket; event enqueues with job ids never collapse into them", async () => {
    const db = fakeDb();
    const t = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00Z`);
    const bucket = `schedule:${Math.floor(t("10:01").getTime() / 900_000)}`;
    const sweep1 = await enqueueSchedule(db, "sweep", undefined, t("10:01"));
    const sweep2 = await enqueueSchedule(db, "sweep", [], t("10:14"));
    expect(sweep2).toBe(sweep1); // same bucket, no ids
    // Same bucket, with ids: a distinct task (its ids used to be swallowed by the sweep's).
    const drop = await enqueueSchedule(db, "drop", ["j2", "j1"], t("10:05"));
    expect(drop).not.toBe(sweep1);
    // The same event again (any id order) is de-duped; another reason or id set is not.
    expect(await enqueueSchedule(db, "drop", ["j1", "j2"], t("10:09"))).toBe(drop);
    expect(await enqueueSchedule(db, "offer_declined", ["j1", "j2"], t("10:09"))).not.toBe(drop);
    expect(await enqueueSchedule(db, "drop", ["j3"], t("10:09"))).not.toBe(drop);
    // Next bucket: a fresh sweep.
    expect(await enqueueSchedule(db, "sweep", undefined, t("10:16"))).not.toBe(sweep1);
    expect(db.tables.fleet_tasks).toHaveLength(5);
    const keys = db.tables.fleet_tasks.map((r) => r.dedupe_key as string);
    expect(keys[0]).toBe(bucket);
    expect(keys[1]).toMatch(new RegExp(`^${bucket}:drop:[0-9a-f]{8}$`));
    expect(scheduleTaskKey("drop", ["j1", "j2"], t("10:01"))).toBe(scheduleTaskKey("drop", ["j2", "j1", "j1"], t("10:14")));
    expect(db.tables.fleet_tasks[1].payload).toEqual({ reason: "drop", job_ids: ["j2", "j1"] });
  });
});

describe("createApproval", () => {
  it("inserts a pending approval", async () => {
    const db = fakeDb();
    const a = await createApproval(db, input());
    expect(a.status).toBe("pending");
    expect(db.tables.approvals).toHaveLength(1);
  });
  it("de-dupes pending approvals with the same kind+ref and refreshes them", async () => {
    const db = fakeDb();
    const a = await createApproval(db, input());
    const b = await createApproval(db, input({ payload: { a: 2 }, summary: "new" }));
    expect(b.id).toBe(a.id);
    expect(b.payload).toEqual({ a: 2 });
    expect(b.summary).toBe("new");
    expect(db.tables.approvals).toHaveLength(1);
  });
  it("does not de-dupe across kind, ref, or decided approvals", async () => {
    const db = fakeDb({ approvals: [approvalRow({ kind: "ad", ref_table: "ads", ref_id: "ad-1", status: "approved" })] });
    await createApproval(db, input());
    await createApproval(db, input({ ref_id: "ad-2" }));
    await createApproval(db, input({ kind: "followup" }));
    expect(db.tables.approvals).toHaveLength(4);
  });
});

describe("requestApproval", () => {
  it("leaves it pending when autopilot is off", async () => {
    const db = fakeDb({ settings: [settingsRow()] });
    const r = await requestApproval(db, input());
    expect(r.autoApproved).toBe(false);
    expect(r.approval.status).toBe("pending");
  });
  it("auto-approves via autopilot using passed settings", async () => {
    const db = fakeDb();
    const r = await requestApproval(db, input({ kind: "followup" }), rules({ followup: { enabled: true } }));
    expect(r.autoApproved).toBe(true);
    expect(r.approval.status).toBe("approved");
    expect(r.approval.decided_by).toBe("autopilot");
    expect(r.approval.decided_at).toBeTruthy();
    expect(db.tables.approvals[0].status).toBe("approved");
  });
  it("loads settings from the db when not passed, and applies the quote cap", async () => {
    const db = fakeDb({ settings: [settingsRow({ autopilot: { ...DEFAULT_AUTOPILOT, quote: { enabled: true, max_total: 100 } } })] });
    const small = await requestApproval(db, input({ kind: "quote", ref_table: "quotes", ref_id: "q1", payload: { price_total: 80 } }));
    const big = await requestApproval(db, input({ kind: "quote", ref_table: "quotes", ref_id: "q2", payload: { price_total: 180 } }));
    expect(small.autoApproved).toBe(true);
    expect(big.autoApproved).toBe(false);
  });
});

describe("decideApproval + handler registry", () => {
  beforeEach(() => clearApprovalHandlers());

  it("records the decision and merges payloadPatch", async () => {
    const row = approvalRow({ payload: { a: 1, b: 2 } });
    const db = fakeDb({ approvals: [row] });
    const out = await decideApproval(db, row.id, "edited", { decidedBy: "owner", note: "tweaked", payloadPatch: { b: 3 } });
    expect(out).toMatchObject({ status: "edited", decided_by: "owner", decision_note: "tweaked", payload: { a: 1, b: 3 } });
    expect(out.decided_at).toBeTruthy();
  });
  it("throws for unknown or already-decided approvals", async () => {
    const row = approvalRow({ status: "rejected" });
    const db = fakeDb({ approvals: [row] });
    await expect(decideApproval(db, "nope", "approved", { decidedBy: "o" })).rejects.toThrow(/not found/);
    await expect(decideApproval(db, row.id, "approved", { decidedBy: "o" })).rejects.toThrow(/already rejected/);
  });
  it("runs the registered handler only for approved/edited", async () => {
    const db = fakeDb();
    const fn = vi.fn();
    registerApprovalHandler("ad", fn);
    const ctx = { siteUrl: "https://x.test", actor: "owner" };
    expect(await applyApproval(db, approvalRow({ kind: "ad", status: "approved" }), ctx)).toBe(true);
    expect(await applyApproval(db, approvalRow({ kind: "ad", status: "edited" }), ctx)).toBe(true);
    expect(await applyApproval(db, approvalRow({ kind: "ad", status: "rejected" }), ctx)).toBe(false);
    expect(await applyApproval(db, approvalRow({ kind: "ad", status: "pending" }), ctx)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][2]).toBe(ctx);
  });
  it("warns and no-ops for an unknown kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await applyApproval(fakeDb(), approvalRow({ kind: "drop", status: "approved" }), { siteUrl: "", actor: "" })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
  it("pendingCounts is zero-filled and counts pending only", async () => {
    const db = fakeDb({
      approvals: [
        approvalRow({ kind: "ad" }), approvalRow({ kind: "ad" }), approvalRow({ kind: "quote" }),
        approvalRow({ kind: "quote", status: "approved" }),
      ],
    });
    const c = await pendingCounts(db);
    expect(c.ad).toBe(2);
    expect(c.quote).toBe(1);
    expect(c.drop).toBe(0);
  });
});

describe("transitionJob", () => {
  const states: JobStatus[] = ["unscheduled", "proposed", "crew_confirmed", "booked", "in_progress", "done", "cancelled"];
  it("allows the happy path", async () => {
    const job = jobRow();
    const db = fakeDb({ jobs: [job] });
    for (const to of ["proposed", "crew_confirmed", "booked", "in_progress", "done"] as const) {
      const out = await transitionJob(db, job.id, to, { actor: "t" });
      expect(out.status).toBe(to);
    }
    const final = db.tables.jobs[0];
    expect(final.started_at).toBeTruthy();
    expect(final.completed_at).toBeTruthy();
  });
  it("allows re-solve and cancel, clearing the slot", async () => {
    const job = jobRow({ status: "proposed", start_at: "2026-02-01T10:00:00Z", end_at: "2026-02-01T11:00:00Z", schedule_reason: "r" });
    const db = fakeDb({ jobs: [job] });
    const out = await transitionJob(db, job.id, "unscheduled", { actor: "t" });
    expect(out).toMatchObject({ status: "unscheduled", start_at: null, end_at: null, schedule_reason: null });
    expect((await transitionJob(db, job.id, "cancelled", { actor: "t" })).status).toBe("cancelled");
  });
  it("rejects illegal moves", async () => {
    for (const from of states) {
      for (const to of states) {
        const legal = JOB_TRANSITIONS[from].includes(to);
        const job = jobRow({ status: from });
        const p = transitionJob(fakeDb({ jobs: [job] }), job.id, to, { actor: "t" });
        if (legal) await expect(p).resolves.toMatchObject({ status: to });
        else await expect(p).rejects.toThrow(/illegal move/);
      }
    }
  });
  it("any non-done state can be cancelled; done and cancelled are terminal", () => {
    for (const s of states.filter((x) => x !== "done" && x !== "cancelled")) expect(JOB_TRANSITIONS[s]).toContain("cancelled");
    expect(JOB_TRANSITIONS.done).toEqual([]);
    expect(JOB_TRANSITIONS.cancelled).toEqual([]);
  });
  it("throws for a missing job", async () => {
    await expect(transitionJob(fakeDb(), "nope", "proposed", { actor: "t" })).rejects.toThrow(/not found/);
  });
});

describe("createJobFromQuote", () => {
  const item = (o: object) => ({
    id: crypto.randomUUID(), quote_id: "q1", status: "auto", price: 50, est_hours: 1, crew_size: 1, ...o,
  });
  it("creates an unscheduled paid job, sums minutes, enqueues schedule, and is idempotent", async () => {
    const db = fakeDb({
      quotes: [{ id: "q1", customer_id: "c1" }],
      quote_items: [
        item({ est_hours: 1.5, crew_size: 2 }) as never,
        item({ status: "priced", est_hours: 0.5, crew_size: 1 }) as never,
        item({ status: "referred", est_hours: 8, crew_size: 5 }) as never,
        item({ status: "needs_owner", price: null, est_hours: 8, crew_size: 5 }) as never,
      ],
    });
    const job = await createJobFromQuote(db, "q1");
    expect(job).toMatchObject({
      quote_id: "q1", customer_id: "c1", status: "unscheduled", paid: true, est_minutes: 120, crew_size: 2, deadline: null,
    });
    expect(job.paid_at).toBeTruthy();
    expect(db.tables.fleet_tasks).toHaveLength(1);
    expect(db.tables.fleet_tasks[0]).toMatchObject({ type: "schedule", role: "scheduler" });

    const again = await createJobFromQuote(db, "q1");
    expect(again.id).toBe(job.id);
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.fleet_tasks).toHaveLength(1);
  });
  it("throws for a missing quote or a quote with nothing billable", async () => {
    await expect(createJobFromQuote(fakeDb(), "zz")).rejects.toThrow(/not found/);
    await expect(createJobFromQuote(fakeDb({ quotes: [{ id: "q1", customer_id: "c" }] }), "q1")).rejects.toThrow(/no priced items/);
  });
});

describe("ensureJobForQuote", () => {
  const item = (o: object) => ({
    id: crypto.randomUUID(), quote_id: "q1", status: "auto", price: 50, est_hours: 1, crew_size: 1, sort_order: 0, ...o,
  });
  const setup = (job: object, hours = 3) =>
    fakeDb({
      quotes: [{ id: "q1", customer_id: "c1" }],
      quote_items: [item({ est_hours: hours, crew_size: 2 }) as never],
      jobs: [jobRow({ id: "j1", quote_id: "q1", customer_id: "c1", est_minutes: 120, crew_size: 2, ...job })],
    });

  it("updates the estimate of a job still on the rail", async () => {
    const db = setup({ status: "unscheduled", start_at: null, end_at: null });
    const job = await ensureJobForQuote(db, "q1");
    expect(job).toMatchObject({ id: "j1", est_minutes: 180, start_at: null, end_at: null });
  });
  it("stretches or shrinks a job already on the calendar, keeping its start", async () => {
    const start = "2026-11-02T14:00:00.000Z";
    const db = setup({ status: "booked", start_at: start, end_at: "2026-11-02T16:00:00.000Z" });
    expect(await ensureJobForQuote(db, "q1")).toMatchObject({ est_minutes: 180, start_at: start, end_at: "2026-11-02T17:00:00.000Z", status: "booked" });

    db.tables.quote_items[0].est_hours = 0.25;
    expect(await ensureJobForQuote(db, "q1")).toMatchObject({ est_minutes: 15, end_at: "2026-11-02T14:30:00.000Z" });
  });
  it("leaves a stale slot on an unscheduled job, and started / done jobs, alone", async () => {
    const db = setup({ status: "unscheduled", start_at: "2026-11-02T14:00:00.000Z", end_at: "2026-11-02T16:00:00.000Z" });
    expect(await ensureJobForQuote(db, "q1")).toMatchObject({ est_minutes: 180, end_at: "2026-11-02T16:00:00.000Z" });
    for (const status of ["in_progress", "done", "cancelled"]) {
      const d = setup({ status, start_at: "2026-11-02T14:00:00.000Z", end_at: "2026-11-02T16:00:00.000Z" });
      expect(await ensureJobForQuote(d, "q1")).toMatchObject({ est_minutes: 120, end_at: "2026-11-02T16:00:00.000Z" });
    }
  });
});

describe("phone", () => {
  it("normalizePhone strips formatting and a leading 1", () => {
    expect(normalizePhone("(440) 823-5545")).toBe("4408235545");
    expect(normalizePhone("+1 440-823-5545")).toBe("4408235545");
    expect(normalizePhone("14408235545")).toBe("4408235545");
    expect(normalizePhone("440.823.5545")).toBe("4408235545");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
  it("formatPhone formats 10-digit numbers and leaves others alone", () => {
    expect(formatPhone("4408235545")).toBe("(440) 823-5545");
    expect(formatPhone("1-440-823-5545")).toBe("(440) 823-5545");
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone(null)).toBe("");
  });
});

describe("upsertCustomer", () => {
  it("creates a new customer with lower-cased email and 10-digit phone", async () => {
    const db = fakeDb();
    const c = await upsertCustomer(db, { name: " Pat ", email: "Pat@Example.COM ", phone: "(440) 823-5545", email_opt_in: true });
    expect(c).toMatchObject({ name: "Pat", email: "pat@example.com", phone: "4408235545", email_opt_in: true, sms_opt_in: false });
  });
  it("matches by lower-cased email", async () => {
    const existing = customerRow({ email: "pat@example.com", phone: null });
    const db = fakeDb({ customers: [existing] });
    const c = await upsertCustomer(db, { name: "Pat", email: "PAT@example.com", phone: "440-823-5545" });
    expect(c.id).toBe(existing.id);
    expect(c.phone).toBe("4408235545"); // filled in
    expect(db.tables.customers).toHaveLength(1);
  });
  it("falls back to normalised phone, including legacy formats", async () => {
    const existing = customerRow({ email: null, phone: "(440) 823-5545" });
    const db = fakeDb({ customers: [existing] });
    const c = await upsertCustomer(db, { name: "Pat", email: "new@example.com", phone: "+1 440 823 5545" });
    expect(c.id).toBe(existing.id);
    expect(c.email).toBe("new@example.com");
    expect(db.tables.customers).toHaveLength(1);
  });
  it("prefers the email match over a different phone match", async () => {
    const byEmail = customerRow({ email: "a@x.com", phone: "5550001111" });
    const byPhone = customerRow({ email: "b@x.com", phone: "4408235545" });
    const db = fakeDb({ customers: [byPhone, byEmail] });
    const c = await upsertCustomer(db, { name: "A", email: "a@x.com", phone: "4408235545" });
    expect(c.id).toBe(byEmail.id);
  });
  it("creates a separate customer when nothing matches", async () => {
    const db = fakeDb({ customers: [customerRow({ email: "a@x.com", phone: "5550001111" })] });
    await upsertCustomer(db, { name: "B", email: "b@x.com", phone: "5552223333" });
    expect(db.tables.customers).toHaveLength(2);
  });
  it("never downgrades a true opt-in unless explicit", async () => {
    const existing = customerRow({ email: "a@x.com", email_opt_in: true, sms_opt_in: true, snow_list: false });
    const db = fakeDb({ customers: [existing] });
    let c = await upsertCustomer(db, { name: "A", email: "a@x.com", email_opt_in: false, sms_opt_in: false, snow_list: true });
    expect(c).toMatchObject({ email_opt_in: true, sms_opt_in: true, snow_list: true });
    c = await upsertCustomer(db, { name: "A", email: "a@x.com", sms_opt_in: false, explicit: true });
    expect(c).toMatchObject({ email_opt_in: true, sms_opt_in: false });
  });
  it("keeps existing values unless explicit", async () => {
    const existing = customerRow({ name: "Old", email: "a@x.com", address: "1 Main St" });
    const db = fakeDb({ customers: [existing] });
    let c = await upsertCustomer(db, { name: "New", email: "a@x.com", address: "2 Elm St" });
    expect(c).toMatchObject({ name: "Old", address: "1 Main St" });
    c = await upsertCustomer(db, { name: "New", email: "a@x.com", address: "2 Elm St", explicit: true });
    expect(c).toMatchObject({ name: "New", address: "2 Elm St" });
  });
});

// ---------- Scheduler integration helpers (lib/ops/jobs.ts) ----------

const T = "2026-01-01T00:00:00.000Z";
const asg = (id: string, job_id: string, crew_id: string, status: string, swap_to_crew_id: string | null = null) =>
  ({ id, created_at: T, updated_at: T, job_id, crew_id, status, responded_at: null, swap_to_crew_id }) as never;
const statuses = (db: ReturnType<typeof fakeDb>, jobId: string) =>
  db.tables.job_assignments.filter((a) => a.job_id === jobId).map((a) => [a.crew_id, a.status]);

describe("transition edges used by the scheduler fixes", () => {
  it("has the edges the code uses and nothing else new", () => {
    expect(JOB_TRANSITIONS.crew_confirmed).toEqual(["booked", "proposed", "unscheduled", "cancelled"]);
    expect(JOB_TRANSITIONS.booked).toEqual(["in_progress", "proposed", "unscheduled", "cancelled"]);
    expect(JOB_TRANSITIONS.proposed).toEqual(["crew_confirmed", "booked", "unscheduled", "cancelled"]); // booked: confirmed by phone
  });
  it("tryTransitionJob applies a patch, and returns null when the job is not in `from`", async () => {
    const job = jobRow({ status: "booked", start_at: "2026-02-01T10:00:00Z", end_at: "2026-02-01T11:00:00Z" });
    const db = fakeDb({ jobs: [job] });
    expect(await tryTransitionJob(db, job.id, "proposed", { actor: "t", from: "crew_confirmed" })).toBeNull();
    expect(db.tables.jobs[0].status).toBe("booked");
    const out = await tryTransitionJob(db, job.id, "unscheduled", { actor: "t", from: ["booked"], patch: { weather_hold_date: "2026-02-01" } });
    expect(out).toMatchObject({ status: "unscheduled", start_at: null, weather_hold_date: "2026-02-01" });
  });
});

describe("drops keep the slot (dropAssignmentKeepSlot / releaseCrewFromJob)", () => {
  const slot = { start_at: "2026-10-20T13:00:00.000Z", end_at: "2026-10-20T15:00:00.000Z" };
  it("booked: only my row is dropped, the job stays booked in its slot, my swaps are withdrawn, and it is marked for cover", async () => {
    const job = jobRow({ id: "j1", status: "booked", crew_size: 2, ...slot });
    const db = fakeDb({
      jobs: [job],
      job_assignments: [asg("a1", "j1", "A", "accepted"), asg("a2", "j1", "B", "accepted"), asg("s1", "j1", "C", "swap_offered", "A")],
    });
    const changed = await dropAssignmentKeepSlot(db, { job_id: "j1", crew_id: "A" }, { actor: "crew:A", from: ["accepted"] });
    expect(changed).toBe(true);
    expect(db.tables.jobs[0]).toMatchObject({ status: "booked", ...slot, resolve_reason: "drop" });
    expect(statuses(db, "j1")).toEqual([["A", "dropped"], ["B", "accepted"]]);
    expect(db.tables.fleet_tasks).toHaveLength(1);
    expect(db.tables.fleet_tasks[0]).toMatchObject({ type: "schedule", payload: { reason: "drop", job_ids: ["j1"] } });
    expect(String(db.tables.fleet_tasks[0].dedupe_key)).toMatch(/^schedule:\d+:drop:[0-9a-f]{8}$/);
  });
  it("crew_confirmed: goes back to proposed (same slot) and only the pending Book card is withdrawn", async () => {
    const job = jobRow({ id: "j1", status: "crew_confirmed", crew_size: 2, ...slot });
    const db = fakeDb({
      jobs: [job],
      job_assignments: [asg("a1", "j1", "A", "accepted"), asg("a2", "j1", "B", "accepted")],
      approvals: [
        approvalRow({ id: "book", kind: "booking", ref_table: "jobs", ref_id: "j1", payload: { job_id: "j1" } }),
        approvalRow({ id: "info", kind: "booking", ref_table: "jobs", ref_id: "j1", payload: { job_id: "j1", needs_cover: true } }),
      ],
    });
    await releaseCrewFromJob(db, "j1", "B", { actor: "owner" });
    expect(db.tables.jobs[0]).toMatchObject({ status: "proposed", ...slot });
    expect(db.tables.approvals.find((a) => a.id === "book")).toMatchObject({ status: "rejected", decided_by: "owner" });
    expect(db.tables.approvals.find((a) => a.id === "info")).toMatchObject({ status: "pending" });
  });
  it("nothing to drop: no status change", async () => {
    const job = jobRow({ id: "j1", status: "crew_confirmed", ...slot });
    const db = fakeDb({ jobs: [job], job_assignments: [asg("a1", "j1", "A", "declined")] });
    expect(await releaseCrewFromJob(db, "j1", "A", { actor: "t" })).toBe(false);
    expect(db.tables.jobs[0].status).toBe("crew_confirmed");
  });
});

describe("dropCrewFromOverlappingJobs (approved time off)", () => {
  it("frees the crew member from overlapping proposed / confirmed / booked jobs only, and marks them crew_change", async () => {
    // 2026-10-20 is a Tuesday; 13:00Z = 9am EDT.
    const db = fakeDb({
      jobs: [
        jobRow({ id: "am", status: "booked", crew_size: 2, start_at: "2026-10-20T13:00:00.000Z", end_at: "2026-10-20T15:00:00.000Z" }),
        jobRow({ id: "pm", status: "proposed", start_at: "2026-10-20T19:00:00.000Z", end_at: "2026-10-20T20:00:00.000Z" }),
        jobRow({ id: "next", status: "booked", start_at: "2026-10-21T13:00:00.000Z", end_at: "2026-10-21T14:00:00.000Z" }),
        jobRow({ id: "cand", status: "booked", start_at: "2026-10-20T14:00:00.000Z", end_at: "2026-10-20T15:00:00.000Z" }),
        jobRow({ id: "on", status: "in_progress", start_at: "2026-10-20T13:00:00.000Z", end_at: "2026-10-20T14:00:00.000Z" }),
      ],
      job_assignments: [
        asg("1", "am", "A", "accepted"), asg("2", "am", "B", "accepted"),
        asg("3", "pm", "A", "offered"),
        asg("4", "next", "A", "accepted"),
        asg("5", "cand", "Z", "accepted"), asg("6", "cand", "A", "swap_offered", "Z"),
        asg("7", "on", "A", "accepted"),
      ],
    });
    // Off 8am–noon local on Tue only.
    const ids = await dropCrewFromOverlappingJobs(db, "A", "2026-10-20", "2026-10-20", "08:00", "12:00");
    expect(ids).toEqual(["am"]);
    expect(statuses(db, "am")).toEqual([["A", "dropped"], ["B", "accepted"]]);
    expect(db.tables.jobs.find((j) => j.id === "am")).toMatchObject({ status: "booked", start_at: "2026-10-20T13:00:00.000Z", resolve_reason: "crew_change" });
    expect(statuses(db, "pm")).toEqual([["A", "offered"]]); // afternoon: outside the partial day
    expect(statuses(db, "next")).toEqual([["A", "accepted"]]); // another day
    expect(statuses(db, "cand")).toEqual([["Z", "accepted"]]); // A's candidate swap row withdrawn
    expect(statuses(db, "on")).toEqual([["A", "accepted"]]); // in progress: untouched
    expect(db.tables.jobs.find((j) => j.id === "cand")?.resolve_reason).toBeNull();
  });
});

describe("maybeConfirmJob", () => {
  it("ignores swap_offered rows when counting available crew, and refreshes the call-to-confirm card", async () => {
    const db = fakeDb({
      settings: [settingsRow()],
      customers: [customerRow({ id: "c1", name: "Pat Smith" })],
      jobs: [jobRow({ id: "j1", customer_id: "c1", status: "proposed", crew_size: 2, start_at: "2026-10-20T13:00:00.000Z", end_at: "2026-10-20T14:00:00.000Z", schedule_reason: "why" })],
      job_assignments: [asg("1", "j1", "A", "accepted"), asg("2", "j1", "B", "accepted"), asg("3", "j1", "C", "swap_offered", "B"), asg("4", "j1", "D", "declined")],
    });
    expect(await maybeConfirmJob(db, "j1", { siteUrl: "https://x.test", actor: "crew-app" })).toBe(true);
    expect(db.tables.jobs[0].status).toBe("crew_confirmed");
    expect(db.tables.approvals).toHaveLength(1);
    expect(db.tables.approvals[0]).toMatchObject({ kind: "booking", ref_id: "j1", payload: { job_id: "j1", call_to_confirm: true }, status: "pending" });
    expect(String(db.tables.approvals[0].title)).toMatch(/^Call Pat Smith: Tue Oct 20/);
    expect(String(db.tables.approvals[0].summary)).toMatch(/2 of 2 crew asked said they're free/);
    // A second call is a no-op (already confirmed).
    expect(await maybeConfirmJob(db, "j1", { siteUrl: "https://x.test", actor: "crew-app" })).toBe(false);
  });
  it("waits for enough yeses (offers nobody answered don't count, nor do dropped / drop-requested rows)", async () => {
    const mk = (rows: never[], crew_size = 2) =>
      fakeDb({ settings: [settingsRow()], jobs: [jobRow({ id: "j1", status: "proposed", crew_size })], job_assignments: rows });
    expect(await maybeConfirmJob(mk([asg("1", "j1", "A", "accepted"), asg("2", "j1", "B", "offered")]), "j1", { siteUrl: "", actor: "t" })).toBe(false);
    expect(await maybeConfirmJob(mk([asg("1", "j1", "A", "accepted"), asg("2", "j1", "B", "dropped")]), "j1", { siteUrl: "", actor: "t" })).toBe(false);
    expect(await maybeConfirmJob(mk([asg("1", "j1", "A", "accepted"), asg("2", "j1", "B", "drop_requested")]), "j1", { siteUrl: "", actor: "t" })).toBe(false);
  });
});

describe("re-solve marks, weather holds, owner holds", () => {
  it("markForResolve only marks open jobs", async () => {
    const db = fakeDb({ jobs: [jobRow({ id: "a", status: "booked" }), jobRow({ id: "b", status: "done" })] });
    await markForResolve(db, ["a", "b", "a"], "declined");
    expect(db.tables.jobs.map((j) => [j.id, j.resolve_reason])).toEqual([["a", "declined"], ["b", null]]);
  });
  it("holdForWeather marks held jobs weather_hold; clearWeatherHold reopens the day and drops only a weather mark", async () => {
    const db = fakeDb({ jobs: [jobRow({ id: "a", status: "booked" }), jobRow({ id: "b", status: "in_progress" })] });
    expect(await holdForWeather(db, ["a", "b"])).toEqual(["a"]);
    expect(db.tables.jobs[0]).toMatchObject({ weather_hold: true, resolve_reason: "weather_hold" });
    expect(db.tables.jobs[1]).toMatchObject({ weather_hold: false, resolve_reason: null });
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "weather_hold", job_ids: ["a"] });
    db.tables.jobs[0].weather_hold_date = "2026-10-20";
    await clearWeatherHold(db, "a");
    expect(db.tables.jobs[0]).toMatchObject({ weather_hold: false, weather_hold_date: null, resolve_reason: null });
  });
  it("setOwnerHold(false) asks the scheduler to look again", async () => {
    const db = fakeDb({ jobs: [jobRow({ id: "a", owner_hold: true })] });
    await setOwnerHold(db, "a", false);
    expect(db.tables.jobs[0].owner_hold).toBe(false);
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "owner_released", job_ids: ["a"] });
  });
});
