import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOPILOT } from "../db/types";
import type { ApprovalKind, AutopilotRules, JobStatus } from "../db/types";
import {
  applyApproval, clearApprovalHandlers, createApproval, createJobFromQuote, decideApproval, enqueueSchedule,
  enqueueTask, formatPhone, getSettings, isAutopiloted, normalizePhone, pendingCounts, registerApprovalHandler,
  requestApproval, taskRoleFor, transitionJob, updateSettings, upsertCustomer, JOB_TRANSITIONS,
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
  it("enqueueSchedule de-dupes within a 15-minute bucket", async () => {
    const db = fakeDb();
    const a = await enqueueSchedule(db, "x", ["j1"], new Date("2026-03-01T10:01:00Z"));
    const b = await enqueueSchedule(db, "y", ["j2"], new Date("2026-03-01T10:14:00Z"));
    const c = await enqueueSchedule(db, "z", undefined, new Date("2026-03-01T10:16:00Z"));
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(db.tables.fleet_tasks).toHaveLength(2);
    expect(db.tables.fleet_tasks[0].payload).toEqual({ reason: "x", job_ids: ["j1"] });
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
