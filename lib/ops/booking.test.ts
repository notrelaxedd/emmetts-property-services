import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sendMessage: vi.fn(), draftMessage: vi.fn() }));
vi.mock("../email", async (importOriginal) => ({ ...(await importOriginal<typeof import("../email")>()), sendMessage: m.sendMessage }));
vi.mock("../ai/claude", () => ({ draftMessage: m.draftMessage }));

import { at, crew, weekdays } from "../scheduler/fixtures";
import { bookJob, fallbackConfirmationEmail, maybeConfirmJob, recordCrewResponse, scheduleJobAt, unplaceJob } from "./booking";
import { approvalRow, customerRow, fakeDb, jobRow, settingsRow } from "./test-utils";

const T = "2026-01-01T00:00:00.000Z";
const ctx = { actor: "owner@example.test", siteUrl: "https://x.test" };
const START = new Date(at("2026-10-12", "09:00"));
const END = new Date(at("2026-10-12", "11:00"));
const asg = (id: string, crew_id: string, status: string, over: Record<string, unknown> = {}) =>
  ({ id, created_at: T, updated_at: T, job_id: "j1", crew_id, status, responded_at: null, swap_to_crew_id: null, respond_token: `tok-${id}`, notified_at: null, ...over }) as never;

function world(jobOver: Record<string, unknown> = {}, quoteOver: Record<string, unknown> = {}) {
  return fakeDb({
    settings: [settingsRow({ card_fee_pct: 0.029, card_fee_fixed: 0.3 })],
    profiles: [crew("A", "Ann Lee", { email: "ann@example.test" }), crew("B", "Bo Diaz", { email: "bo@example.test" })],
    crew_availability: [...weekdays("A"), ...weekdays("B")],
    customers: [customerRow({ id: "c1", name: "Pat Smith", email: "pat@example.test", phone: "4405550100", address: "1 Lake Rd" })],
    leads: [{ id: "l1", customer_id: "c1", status: "quoted" }] as never,
    quotes: [{ id: "q1", created_at: T, updated_at: T, lead_id: "l1", customer_id: "c1", status: "draft", price_total: 180, labor_total: 90, fee_total: 5.52, profit_total: 84.48, margin: 0.5, wage: 15, payment_method: null, paid_at: null, accepted_at: null, sent_at: null, rationale: null, ...quoteOver }] as never,
    quote_items: [{ id: "i1", quote_id: "q1", description: "Leaf cleanup", status: "auto", price: 180, crew_size: 2, est_hours: 2, sort_order: 0 }] as never,
    jobs: [jobRow({ id: "j1", quote_id: "q1", customer_id: "c1", status: "unscheduled", crew_size: 2, est_minutes: 120, paid: false, paid_at: null, ...jobOver })],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  m.sendMessage.mockResolvedValue({ status: "sent", providerId: "p1" });
  m.draftMessage.mockRejectedValue(new Error("AI off in tests"));
});

describe("scheduleJobAt (drag onto the calendar)", () => {
  it("places an unscheduled job, asks every free crew member by email, and raises the call-to-confirm card", async () => {
    const db = world();
    const res = await scheduleJobAt(db, "j1", START, END, ctx);
    expect(res).toMatchObject({ asked: 2, emailed: 2, reconfirm: false });
    expect(db.tables.jobs[0]).toMatchObject({ status: "proposed", start_at: START.toISOString(), end_at: END.toISOString(), schedule_reason: "Placed by owner@example.test" });
    expect(db.tables.job_assignments.map((a) => [a.crew_id, a.status, !!a.notified_at]).sort()).toEqual([
      ["A", "offered", true],
      ["B", "offered", true],
    ]);
    const card = db.tables.approvals[0];
    expect(card).toMatchObject({ kind: "booking", ref_table: "jobs", ref_id: "j1", status: "pending", title: "Call Pat Smith: Mon Oct 12, 9:00–11:00am" });
    expect(card.payload).toMatchObject({ job_id: "j1", call_to_confirm: true, phone: "4405550100", price_total: 180 });
    expect(String(card.summary)).toBe("$180, collected after the job · 2 crew, 2h · 0 of 2 crew asked said they're free");
  });

  it("moving a confirmed job re-asks the crew and flags the card as a re-confirm", async () => {
    const db = world({ status: "booked", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.job_assignments = [asg("a1", "A", "accepted", { responded_at: T, notified_at: T })];
    db.tables.fleet_tasks = [{ id: "t1", dedupe_key: "reminder:j1", status: "queued", type: "followup_reminder" }];
    const later = new Date(at("2026-10-13", "09:00"));
    const res = await scheduleJobAt(db, "j1", later, new Date(at("2026-10-13", "11:00")), ctx);
    expect(res.reconfirm).toBe(true);
    expect(db.tables.jobs[0]).toMatchObject({ status: "proposed", start_at: later.toISOString() });
    expect(db.tables.job_assignments.map((a) => [a.crew_id, a.status, a.responded_at]).sort()).toEqual([
      ["A", "offered", null],
      ["B", "offered", null],
    ]);
    expect(db.tables.fleet_tasks).toHaveLength(0); // the old day-before reminder is gone
    expect(String(db.tables.approvals[0].title)).toMatch(/^Re-confirm with Pat Smith: Tue Oct 13/);
  });

  it("refuses a job that already started", async () => {
    const db = world({ status: "in_progress", start_at: START.toISOString(), end_at: END.toISOString() });
    await expect(scheduleJobAt(db, "j1", START, END, ctx)).rejects.toThrow(/can't be moved/);
  });
});

describe("recordCrewResponse + maybeConfirmJob", () => {
  it("enough yeses confirm the crew; a later no drops it back and asks the scheduler for cover", async () => {
    const db = world({ status: "proposed", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.job_assignments = [asg("a1", "A", "offered"), asg("a2", "B", "offered")];
    const a1 = () => db.tables.job_assignments.find((a) => a.id === "a1") as never;
    const a2 = () => db.tables.job_assignments.find((a) => a.id === "a2") as never;

    expect(await recordCrewResponse(db, a1(), "accepted", ctx)).toMatchObject({ changed: true, confirmed: false, jobStatus: "proposed" });
    expect(await recordCrewResponse(db, a2(), "accepted", ctx)).toMatchObject({ changed: true, confirmed: true, jobStatus: "crew_confirmed" });
    expect(db.tables.jobs[0].status).toBe("crew_confirmed");
    expect(String(db.tables.approvals[0].summary)).toMatch(/2 of 2 crew asked said they're free/);

    // Bo changes his mind: back to waiting on crew, cover requested for the same slot.
    expect(await recordCrewResponse(db, a2(), "declined", ctx)).toMatchObject({ changed: true, jobStatus: "proposed" });
    expect(db.tables.jobs[0]).toMatchObject({ status: "proposed", start_at: START.toISOString(), resolve_reason: "declined" });
    expect(db.tables.fleet_tasks.some((t) => t.type === "schedule")).toBe(true);
    // Same answer twice is a no-op; an answer on a booked job is refused.
    expect(await recordCrewResponse(db, a2(), "declined", ctx)).toMatchObject({ changed: false });
    db.tables.jobs[0].status = "booked";
    expect(await recordCrewResponse(db, a2(), "accepted", ctx)).toMatchObject({ changed: false, jobStatus: "booked" });
  });

  it("maybeConfirmJob needs crew_size yeses and ignores unanswered offers", async () => {
    const db = world({ status: "proposed", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.job_assignments = [asg("a1", "A", "accepted"), asg("a2", "B", "offered")];
    expect(await maybeConfirmJob(db, "j1", ctx)).toBe(false);
    db.tables.jobs[0].crew_size = 1;
    expect(await maybeConfirmJob(db, "j1", ctx)).toBe(true);
  });
});

describe("bookJob (the customer said yes on the phone)", () => {
  it("puts the chosen crew on, withdraws the rest, books the job, confirms the quote unpaid, emails the customer and queues the reminder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at("2026-10-05", "12:00")));
    try {
      const db = world({ status: "crew_confirmed", start_at: START.toISOString(), end_at: END.toISOString() });
      db.tables.job_assignments = [asg("a1", "A", "accepted", { responded_at: T }), asg("a2", "B", "offered")];
      db.tables.approvals = [approvalRow({ kind: "booking", ref_table: "jobs", ref_id: "j1", payload: { job_id: "j1", call_to_confirm: true } })];

      const res = await bookJob(db, "j1", { paymentMethod: "check", crewIds: ["A"], actor: "owner@example.test", siteUrl: "https://x.test", note: "Gate code 1234" });
      expect(res.confirmationSent).toBe(true);
      expect(db.tables.jobs[0]).toMatchObject({ status: "booked", crew_size: 1, paid: false });
      expect(db.tables.job_assignments.map((a) => [a.crew_id, a.status])).toEqual([["A", "accepted"]]);
      const q = db.tables.quotes[0];
      expect(q).toMatchObject({ status: "accepted", payment_method: "check", paid_at: null, fee_total: 0, profit_total: 90 });
      expect(q.accepted_at).toBe(new Date().toISOString());
      expect(String(q.rationale)).toMatch(/Confirmed by phone \(owner@example.test\): Mon Oct 12, 9:00–11:00am, pays by check after the job\. Gate code 1234/);
      expect(db.tables.leads[0].status).toBe("won");
      expect(db.tables.approvals[0]).toMatchObject({ status: "approved", decided_by: "owner@example.test" });
      const msg = db.tables.messages[0];
      expect(msg).toMatchObject({ kind: "confirmation", channel: "email", job_id: "j1", customer_id: "c1" });
      expect(String(msg.body)).toContain("Nothing to pay now: as agreed, we'll collect payment by check once the job is done.");
      expect(m.sendMessage).toHaveBeenCalledWith(db, msg.id, { siteUrl: "https://x.test" });
      const reminder = db.tables.fleet_tasks.find((t) => t.type === "followup_reminder")!;
      expect(reminder).toMatchObject({ dedupe_key: "reminder:j1", payload: { job_id: "j1" } });
      expect(Date.parse(String(reminder.run_after))).toBe(START.getTime() - 86_400_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("card keeps the card fee; booking with nobody ticked is 'just me'; a crew member no longer on the list is refused", async () => {
    const db = world({ status: "proposed", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.job_assignments = [asg("a1", "A", "declined")];
    await expect(bookJob(db, "j1", { paymentMethod: "stripe", crewIds: ["A"], ...ctx })).rejects.toThrow(/isn't on the offer list/);
    const res = await bookJob(db, "j1", { paymentMethod: "stripe", crewIds: [], ...ctx });
    expect(res.job).toMatchObject({ status: "booked", crew_size: 1 });
    expect(db.tables.job_assignments).toHaveLength(0);
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", payment_method: "stripe", fee_total: 5.52, profit_total: 84.48 });
    expect(String(db.tables.messages[0].body)).toMatch(/by card once the job is done \(we'll email you a secure card link\)/);
  });

  it("refuses a job that isn't on the calendar, one already booked, and a quote with an unpriced line", async () => {
    await expect(bookJob(world(), "j1", { paymentMethod: "cash", crewIds: [], ...ctx })).rejects.toThrow(/Put the job on the calendar first/);
    await expect(bookJob(world({ status: "booked", start_at: START.toISOString(), end_at: END.toISOString() }), "j1", { paymentMethod: "cash", crewIds: [], ...ctx })).rejects.toThrow(/already confirmed/);
    const db = world({ status: "proposed", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.quote_items.push({ id: "i2", quote_id: "q1", description: "Stump", status: "needs_owner", price: null, crew_size: 1, est_hours: 0, sort_order: 1 } as never);
    await expect(bookJob(db, "j1", { paymentMethod: "cash", crewIds: [], ...ctx })).rejects.toThrow(/still needs your price/);
  });
});

describe("unplaceJob", () => {
  it("takes the job back to the rail, withdraws every offer and closes the call card", async () => {
    const db = world({ status: "crew_confirmed", start_at: START.toISOString(), end_at: END.toISOString() });
    db.tables.job_assignments = [asg("a1", "A", "accepted"), asg("a2", "B", "offered")];
    db.tables.approvals = [approvalRow({ kind: "booking", ref_table: "jobs", ref_id: "j1", payload: { job_id: "j1", call_to_confirm: true } })];
    await unplaceJob(db, "j1", { actor: "owner" });
    expect(db.tables.jobs[0]).toMatchObject({ status: "unscheduled", start_at: null, owner_hold: true });
    expect(db.tables.job_assignments).toHaveLength(0);
    expect(db.tables.approvals[0]).toMatchObject({ status: "rejected", decision_note: "Taken off the calendar." });
  });
});

describe("fallbackConfirmationEmail", () => {
  it("adds the nothing-to-pay-now line only when a payment method is known", () => {
    const base = { firstName: "Dana", services: ["Mowing"], when: "Mon Oct 12, 9:00–11:00am", address: "1 Lake Rd" };
    expect(fallbackConfirmationEmail(base).body).not.toMatch(/Nothing to pay now/);
    expect(fallbackConfirmationEmail({ ...base, paymentMethod: "cash" }).body).toContain("we'll collect payment by cash once the job is done.");
  });
});
