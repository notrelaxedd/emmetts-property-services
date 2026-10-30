import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  invoiceRetrieve: vi.fn(),
  invoiceVoid: vi.fn(),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    static API_VERSION = "2026-09-30.endive";
    checkout = { sessions: { retrieve: m.sessionRetrieve, expire: m.sessionExpire } };
    invoices = { retrieve: m.invoiceRetrieve, voidInvoice: m.invoiceVoid };
    constructor(
      public key: string,
      public opts: Record<string, unknown>,
    ) {}
  }
  return { default: FakeStripe };
});

import type Stripe from "stripe";
import { resetStripeClient } from "../stripe/client";
import { handleStripeEvent } from "../stripe/webhook";
import { recordOfflinePayment } from "./payments";
import { customerRow, fakeDb, settingsRow } from "./test-utils";

const T0 = "2026-01-01T00:00:00.000Z";
const item = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), created_at: T0, updated_at: T0, quote_id: "q1", service_id: null, description: "Mowing",
  is_custom: false, crew_size: 1, est_hours: 1, price: 80, status: "auto", partner_note: null, ai_summary: null,
  sort_order: 0, ...over,
});
const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1", created_at: T0, updated_at: T0, lead_id: "l1", customer_id: "c1", status: "sent", price_total: 80,
  labor_total: 30, fee_total: 2.62, profit_total: 47.38, margin: 0.5, wage: 15, stripe_checkout_id: null,
  stripe_checkout_url: null, stripe_payment_intent_id: null, stripe_invoice_id: null, stripe_invoice_url: null,
  payment_method: null, sent_at: T0, accepted_at: null, expires_at: null, rationale: null, ...over,
});
const world = (q = {}) =>
  fakeDb({
    quotes: [quote(q)] as never,
    quote_items: [item()] as never,
    customers: [customerRow({ id: "c1", email: "jo@example.com", name: "Jo Smith" })],
    leads: [{ id: "l1", status: "quoted" }] as never,
    settings: [settingsRow()],
  });
const check = (over: Partial<Parameters<typeof recordOfflinePayment>[2]> = {}) => ({
  method: "check" as const, amount: 80, checkNumber: "1042", recordedBy: "owner@example.com", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  resetStripeClient();
});

describe("recordOfflinePayment", () => {
  it("accepts the quote with no card fee, notes the check, wins the lead and books the job", async () => {
    const db = world();
    await recordOfflinePayment(db, "q1", check());
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ status: "accepted", payment_method: "check", fee_total: 0, profit_total: 50, stripe_payment_intent_id: null });
    expect(q.accepted_at).toBeTruthy();
    expect(String(q.rationale)).toMatch(/Paid by check #1042: \$80\.00, recorded by owner@example\.com\./);
    expect(String(q.rationale)).not.toContain("WARNING");
    expect(db.tables.leads[0].status).toBe("won");
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.jobs[0]).toMatchObject({ quote_id: "q1", status: "unscheduled" });
    expect(db.tables.fleet_tasks.map((t) => t.type)).toEqual(["schedule"]);
    expect(m.sessionRetrieve).not.toHaveBeenCalled();
    expect(m.invoiceRetrieve).not.toHaveBeenCalled();
  });

  it("works for cash on a draft or an expired quote, and flags a different amount", async () => {
    const db = world({ status: "expired" });
    await recordOfflinePayment(db, "q1", check({ method: "cash", amount: 70, checkNumber: "ignored" }));
    const note = String(db.tables.quotes[0].rationale);
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", payment_method: "cash" });
    expect(note).toContain("Paid by cash: $70.00");
    expect(note).not.toContain("ignored");
    expect(note).toMatch(/WARNING: Paid amount differs from quote — received \$70\.00 by cash but the quote total is \$80\.00\. Collect the difference\./);

    expect(db.tables.quotes[0].price_total).toBe(80);

    const draft = world({ status: "draft" });
    await recordOfflinePayment(draft, "q1", check());
    expect(draft.tables.quotes[0].status).toBe("accepted");
  });

  it("counts anything paid over the quote as a tip, in the total (revenue) and profit, with no warning", async () => {
    const db = world();
    await recordOfflinePayment(db, "q1", check({ method: "cash", amount: 100 }));
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ price_total: 100, fee_total: 0, profit_total: 70 });
    expect(String(q.rationale)).toContain("Paid by cash: $100.00 (quote $80.00 + $20.00 tip), recorded by owner@example.com.");
    expect(String(q.rationale)).not.toMatch(/WARNING|Return/);
  });

  it("the usual case: a quote confirmed by phone, job done, check handed over → paid, job marked paid, nothing re-scheduled", async () => {
    const db = world({ status: "accepted", accepted_at: "2026-01-02T00:00:00Z", payment_method: "check", paid_at: null, fee_total: 0 });
    db.tables.jobs = [{ id: "j1", quote_id: "q1", customer_id: "c1", status: "done", paid: false, paid_at: null, est_minutes: 60, crew_size: 1 }];
    const res = await recordOfflinePayment(db, "q1", check());
    expect(res.jobId).toBe("j1");
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", accepted_at: "2026-01-02T00:00:00Z", payment_method: "check", fee_total: 0 });
    expect(db.tables.quotes[0].paid_at).toBeTruthy();
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.jobs[0]).toMatchObject({ status: "done", paid: true });
    expect(db.tables.jobs[0].paid_at).toBeTruthy();
    expect(db.tables.fleet_tasks ?? []).toHaveLength(0);
  });

  it("refuses a paid or declined quote and a zero amount", async () => {
    await expect(recordOfflinePayment(world({ status: "accepted", paid_at: "2026-01-02T00:00:00Z" }), "q1", check())).rejects.toThrow(/already paid/);
    await expect(recordOfflinePayment(world({ status: "declined" }), "q1", check())).rejects.toThrow(/declined/);
    await expect(recordOfflinePayment(world(), "q1", check({ amount: 0 }))).rejects.toThrow(/more than \$0/);
  });

  it("expires the open Checkout link and voids the open invoice first", async () => {
    const db = world({ stripe_checkout_id: "cs_1", stripe_checkout_url: "u", stripe_invoice_id: "in_1", stripe_invoice_url: "i" });
    m.sessionRetrieve.mockResolvedValue({ id: "cs_1", status: "open" });
    m.sessionExpire.mockResolvedValue({ id: "cs_1", status: "expired" });
    m.invoiceRetrieve.mockResolvedValue({ id: "in_1", status: "open" });
    m.invoiceVoid.mockResolvedValue({ id: "in_1", status: "void" });
    await recordOfflinePayment(db, "q1", check());
    expect(m.sessionExpire).toHaveBeenCalledWith("cs_1");
    expect(m.invoiceVoid).toHaveBeenCalledWith("in_1");
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", stripe_checkout_url: null, stripe_invoice_url: null });
  });

  it("refuses, leaving the quote alone, when the customer already paid online", async () => {
    const db = world({ stripe_checkout_id: "cs_1", stripe_checkout_url: "u" });
    m.sessionRetrieve.mockResolvedValue({ id: "cs_1", status: "complete" });
    await expect(recordOfflinePayment(db, "q1", check())).rejects.toThrow(/already paid/);
    expect(db.tables.quotes[0]).toMatchObject({ status: "sent", payment_method: null, rationale: null });
    expect(db.tables.jobs ?? []).toHaveLength(0);
  });
});

describe("Stripe payments and cash / check", () => {
  const evt = (id: string, object: Record<string, unknown>) =>
    ({ id, type: "checkout.session.completed", data: { object } }) as unknown as Stripe.Event;
  const paid = (over: Record<string, unknown> = {}) => ({
    id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 8000, metadata: { quote_id: "q1" }, ...over,
  });

  it("a Stripe payment marks the quote paid by stripe", async () => {
    const db = world({ stripe_checkout_id: "cs_1" });
    await handleStripeEvent(db, evt("evt_1", paid()), { siteUrl: "https://example.test" });
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", payment_method: "stripe", stripe_payment_intent_id: "pi_1" });
  });

  it("a Stripe payment for a quote already paid by check is flagged for a manual refund, not attached", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world();
    await recordOfflinePayment(db, "q1", check());
    await handleStripeEvent(db, evt("evt_1", paid()), { siteUrl: "https://example.test" });
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ status: "accepted", payment_method: "check", stripe_payment_intent_id: null });
    expect(String(q.rationale)).toContain("second payment pi_1 ($80.00) received for this already-paid quote (checkout cs_1; it was paid by check)");
    const alert = (db.tables.approvals ?? []).find((a) => a.kind === "quote");
    expect(alert?.payload).toMatchObject({ alert: "double_payment", payment_intent: "pi_1", first_payment_method: "check" });
    expect(db.tables.jobs).toHaveLength(1);
    err.mockRestore();
  });
});
