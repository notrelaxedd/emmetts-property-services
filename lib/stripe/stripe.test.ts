import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  refundCreate: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    static API_VERSION = "2026-09-30.endive";
    checkout = { sessions: { create: m.create, retrieve: m.retrieve, expire: m.expire } };
    refunds = { create: m.refundCreate };
    webhooks = { constructEvent: m.constructEvent };
    constructor(
      public key: string,
      public opts: Record<string, unknown>,
    ) {}
  }
  return { default: FakeStripe };
});

import type Stripe from "stripe";
import { customerRow, fakeDb, jobRow, settingsRow } from "../ops/test-utils";
import { buildCheckoutLines, checkoutExpiresAt, createCheckoutForQuote, expireOpenCheckout, refundQuote } from "./checkout";
import { getStripe, resetStripeClient } from "./client";
import { handleStripeEvent } from "./webhook";

const SITE = "https://example.test";
const T0 = "2026-01-01T00:00:00.000Z";

const item = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), created_at: T0, updated_at: T0, quote_id: "q1", service_id: null, description: "Mowing",
  is_custom: false, crew_size: 1, est_hours: 1, price: 50, status: "auto", partner_note: null, ai_summary: null,
  sort_order: 0, ...over,
});
const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1", created_at: T0, updated_at: T0, lead_id: "l1", customer_id: "c1", status: "sent", price_total: 80,
  labor_total: 0, fee_total: 0, profit_total: 0, margin: 0.5, wage: 15, stripe_checkout_id: null,
  stripe_checkout_url: null, stripe_payment_intent_id: null, sent_at: null, accepted_at: null, expires_at: null,
  rationale: null, ...over,
});
const world = (q = {}, items = [item({ description: "Mowing", price: 50 }), item({ description: "Edging", price: 30, sort_order: 1 })]) =>
  fakeDb({
    quotes: [quote(q)] as never,
    quote_items: items as never,
    customers: [customerRow({ id: "c1", email: "jo@example.com", name: "Jo Smith" })],
    leads: [{ id: "l1", status: "quoted" }] as never,
    settings: [settingsRow()],
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  resetStripeClient();
  m.create.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
});

describe("getStripe", () => {
  it("throws a clear error without a key, warns on a non-test key, pins the SDK api version", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY is not set/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.STRIPE_SECRET_KEY = "sk_live_nope";
    resetStripeClient();
    const s = getStripe() as unknown as { opts: Record<string, unknown> };
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TEST key"));
    expect(s.opts).toMatchObject({ apiVersion: "2026-09-30.endive", typescript: true });
    warn.mockRestore();
  });
});

describe("buildCheckoutLines", () => {
  it("skips declined / referred / unpriced items and converts to cents", () => {
    const lines = buildCheckoutLines(
      [
        item({ description: "A", price: 12.34 }),
        item({ description: "B", price: 20, status: "priced", sort_order: 1 }),
        item({ description: "declined", price: 99, status: "declined", sort_order: 2 }),
        item({ description: "referred", price: 99, status: "referred", sort_order: 3 }),
        item({ description: "needs owner", price: null, status: "needs_owner", sort_order: 4 }),
        item({ description: "no price", price: null, status: "priced", sort_order: 5 }),
      ] as never,
      32.34,
    );
    expect(lines).toEqual([
      { name: "A", unitAmount: 1234 },
      { name: "B", unitAmount: 2000 },
    ]);
  });
  it("adds a Minimum job adjustment for the floor", () => {
    const lines = buildCheckoutLines([item({ price: 30 })] as never, 75);
    expect(lines).toEqual([
      { name: "Mowing", unitAmount: 3000 },
      { name: "Minimum job adjustment", unitAmount: 4500 },
    ]);
  });
  it("scales down when the owner lowered the total, charging exactly price_total", () => {
    const lines = buildCheckoutLines([item({ price: 50 }), item({ price: 30, sort_order: 1 })] as never, 60);
    expect(lines.reduce((s, l) => s + l.unitAmount, 0)).toBe(6000);
    expect(lines.every((l) => l.name !== "Minimum job adjustment")).toBe(true);
  });
  it("throws with nothing billable", () => {
    expect(() => buildCheckoutLines([item({ status: "declined" })] as never, 50)).toThrow(/no priced items/);
  });
  it("expires within Stripe's 24h cap", () => {
    const now = new Date("2026-05-05T10:30:00Z");
    const exp = checkoutExpiresAt(now) * 1000;
    expect(exp - now.getTime()).toBeLessThanOrEqual(24 * 3_600_000);
    expect(exp - now.getTime()).toBeGreaterThan(22 * 3_600_000);
  });
});

describe("createCheckoutForQuote", () => {
  it("creates a payment session and saves id + url on the quote", async () => {
    const db = world({ price_total: 100 });
    const res = await createCheckoutForQuote(db, "q1", { siteUrl: `${SITE}/` });
    expect(res).toEqual({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
    const [params, opts] = m.create.mock.calls[0];
    expect(params).toMatchObject({
      mode: "payment",
      customer_email: "jo@example.com",
      metadata: { quote_id: "q1", customer_id: "c1" },
      success_url: `${SITE}/quote/paid?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/quote/thanks?cancelled=1`,
    });
    expect(params.line_items.map((l: Stripe.Checkout.SessionCreateParams.LineItem) => [l.price_data?.product_data?.name, l.price_data?.unit_amount])).toEqual([
      ["Mowing", 5000],
      ["Edging", 3000],
      ["Minimum job adjustment", 2000],
    ]);
    expect(opts.idempotencyKey).toMatch(/^quote-q1-[0-9a-f]{16}$/);
    expect(db.tables.quotes[0]).toMatchObject({ stripe_checkout_id: "cs_1", stripe_checkout_url: "https://checkout.stripe.test/cs_1" });
  });
  it("reuses a still-open identical session", async () => {
    const db = world({ price_total: 80 });
    await createCheckoutForQuote(db, "q1", { siteUrl: SITE });
    const hash = m.create.mock.calls[0][0].metadata.items_hash;
    m.retrieve.mockResolvedValue({ id: "cs_1", status: "open", url: "https://checkout.stripe.test/cs_1", metadata: { items_hash: hash } });
    const again = await createCheckoutForQuote(db, "q1", { siteUrl: SITE });
    expect(again.id).toBe("cs_1");
    expect(m.create).toHaveBeenCalledTimes(1);
  });
  it("expires the old open session when the quote changed", async () => {
    const db = world({ price_total: 80, stripe_checkout_id: "cs_old" });
    m.retrieve.mockResolvedValue({ id: "cs_old", status: "open", url: "u", metadata: { items_hash: "stale" } });
    m.expire.mockResolvedValue({});
    await createCheckoutForQuote(db, "q1", { siteUrl: SITE });
    expect(m.expire).toHaveBeenCalledWith("cs_old");
    expect(m.create).toHaveBeenCalledTimes(1);
  });
  it("requires a customer email", async () => {
    const db = fakeDb({ quotes: [quote()] as never, quote_items: [item()] as never, customers: [customerRow({ id: "c1", email: null })] });
    await expect(createCheckoutForQuote(db, "q1", { siteUrl: SITE })).rejects.toThrow(/no email/);
  });
});

describe("refundQuote", () => {
  it("refunds, cancels the job and declines the quote", async () => {
    const db = world({ status: "accepted", stripe_payment_intent_id: "pi_1" });
    db.tables.jobs = [jobRow({ id: "j1", quote_id: "q1", customer_id: "c1" }) as never];
    m.refundCreate.mockResolvedValue({ id: "re_1", charge: "ch_1" });
    const res = await refundQuote(db, "q1", { reason: "customer cancelled" });
    expect(res).toEqual({ refundId: "re_1", jobCancelled: true });
    expect(m.refundCreate.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_1" });
    expect(db.tables.jobs[0].status).toBe("cancelled");
    expect(db.tables.quotes[0]).toMatchObject({ status: "declined" });
    expect(String(db.tables.quotes[0].rationale)).toContain("re_1");
  });
  it("refuses before touching Stripe when the job is done", async () => {
    const db = world({ status: "accepted", stripe_payment_intent_id: "pi_1" });
    db.tables.jobs = [jobRow({ id: "j1", quote_id: "q1", status: "done" }) as never];
    await expect(refundQuote(db, "q1", { reason: "x" })).rejects.toThrow(/cannot be cancelled/);
    expect(m.refundCreate).not.toHaveBeenCalled();
  });
  it("needs a stored payment intent", async () => {
    await expect(refundQuote(world(), "q1", { reason: "x" })).rejects.toThrow(/no payment/);
  });
});

const evt = (id: string, type: string, object: Record<string, unknown>) =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;
const paidSession = (over: Record<string, unknown> = {}) => ({
  id: "cs_1", payment_status: "paid", payment_intent: "pi_1", metadata: { quote_id: "q1", customer_id: "c1" }, ...over,
});

describe("handleStripeEvent", () => {
  it("checkout.session.completed accepts the quote, wins the lead, creates the job and enqueues schedule", async () => {
    const db = world({ stripe_checkout_id: "cs_1" });
    const res = await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", paidSession()), { siteUrl: SITE });
    expect(res).toEqual({ duplicate: false, processed: true });
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", stripe_payment_intent_id: "pi_1" });
    expect(db.tables.quotes[0].accepted_at).toBeTruthy();
    expect(db.tables.leads[0].status).toBe("won");
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.jobs[0]).toMatchObject({ quote_id: "q1", paid: true, status: "unscheduled" });
    expect(db.tables.fleet_tasks.map((t) => t.type)).toEqual(["schedule"]);
    expect(db.tables.stripe_events[0]).toMatchObject({ stripe_event_id: "evt_1", type: "checkout.session.completed" });
    expect(db.tables.stripe_events[0].processed_at).toBeTruthy();
  });
  it("is idempotent: a duplicate event is a no-op", async () => {
    const db = world();
    const e = evt("evt_1", "checkout.session.completed", paidSession());
    await handleStripeEvent(db, e, { siteUrl: SITE });
    const res = await handleStripeEvent(db, e, { siteUrl: SITE });
    expect(res).toMatchObject({ duplicate: true });
    expect(db.tables.stripe_events).toHaveLength(1);
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.fleet_tasks).toHaveLength(1);
  });
  it("ignores unpaid sessions and records unknown events as processed", async () => {
    const db = world();
    await handleStripeEvent(db, evt("evt_a", "checkout.session.completed", paidSession({ payment_status: "unpaid" })), { siteUrl: SITE });
    expect(db.tables.quotes[0].status).toBe("sent");
    const res = await handleStripeEvent(db, evt("evt_b", "customer.created", { id: "cus_1" }), { siteUrl: SITE });
    expect(res.processed).toBe(true);
    expect(db.tables.stripe_events.every((r) => r.processed_at)).toBe(true);
  });
  it("leaves a failing event unprocessed and retries it on redelivery", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ quotes: [], leads: [], quote_items: [] });
    const e = evt("evt_1", "checkout.session.completed", paidSession());
    const res = await handleStripeEvent(db, e, { siteUrl: SITE });
    expect(res.processed).toBe(false);
    expect(db.tables.stripe_events[0].processed_at).toBeNull();
    db.tables.quotes.push(quote() as never);
    db.tables.quote_items.push(item() as never);
    db.tables.leads.push({ id: "l1", status: "quoted" } as never);
    const retry = await handleStripeEvent(db, e, { siteUrl: SITE });
    expect(retry).toEqual({ duplicate: false, processed: true });
    expect(db.tables.stripe_events).toHaveLength(1);
    err.mockRestore();
  });
  it("checkout.session.expired clears the stale link but keeps the quote sent (the pay link mints a new session)", async () => {
    const db = world({ stripe_checkout_id: "cs_2", stripe_checkout_url: "https://checkout.stripe.test/cs_2" });
    await handleStripeEvent(db, evt("evt_old", "checkout.session.expired", paidSession({ id: "cs_1", payment_status: "unpaid" })), { siteUrl: SITE });
    expect(db.tables.quotes[0].stripe_checkout_url).toBe("https://checkout.stripe.test/cs_2");
    await handleStripeEvent(db, evt("evt_cur", "checkout.session.expired", paidSession({ id: "cs_2", payment_status: "unpaid" })), { siteUrl: SITE });
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(db.tables.quotes[0].stripe_checkout_url).toBeNull();
  });
  it("expired does not touch an accepted quote", async () => {
    const db = world({ status: "accepted", stripe_checkout_id: "cs_1" });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.expired", paidSession({ payment_status: "unpaid" })), { siteUrl: SITE });
    expect(db.tables.quotes[0].status).toBe("accepted");
  });
  it("charge.refunded appends a note once", async () => {
    const db = world({ status: "accepted", stripe_payment_intent_id: "pi_1" });
    const charge = { id: "ch_1", payment_intent: "pi_1", amount_refunded: 8000 };
    await handleStripeEvent(db, evt("evt_1", "charge.refunded", charge), { siteUrl: SITE });
    await handleStripeEvent(db, evt("evt_2", "charge.refunded", charge), { siteUrl: SITE });
    const note = String(db.tables.quotes[0].rationale);
    expect(note).toContain("ch_1");
    expect(note).toContain("$80.00");
    expect(note.match(/ch_1/g)).toHaveLength(1);
  });
});

describe("handleStripeEvent: paid amount and double payment checks", () => {
  const alerts = (db: ReturnType<typeof world>) => (db.tables.approvals ?? []).filter((a) => a.kind === "quote");

  it("a payment matching the quote total raises no alert", async () => {
    const db = world({ price_total: 80 });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", paidSession({ amount_total: 8000 })), { siteUrl: SITE });
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", rationale: null });
    expect(alerts(db)).toHaveLength(0);
  });

  it("a different paid amount still accepts the quote and books the job, but notes it loudly and raises a quote approval", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ price_total: 80, rationale: "priced from the catalogue" });
    const e = evt("evt_1", "checkout.session.completed", paidSession({ amount_total: 6000 }));
    const res = await handleStripeEvent(db, e, { siteUrl: SITE });
    expect(res).toEqual({ duplicate: false, processed: true });
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ status: "accepted", stripe_payment_intent_id: "pi_1" });
    expect(String(q.rationale)).toMatch(/^priced from the catalogue\n/);
    expect(String(q.rationale)).toMatch(/Paid amount differs from quote.*\$60\.00.*\$80\.00/);
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.leads[0].status).toBe("won");
    const [alert] = alerts(db);
    expect(alert).toMatchObject({
      kind: "quote", status: "pending", title: "Paid amount differs from quote", ref_table: "stripe_events",
      ref_id: db.tables.stripe_events[0].id, created_by: "stripe-webhook",
    });
    expect(alert.payload).toMatchObject({ quote_id: "q1", alert: "amount_mismatch", amount_paid: 6000, amount_expected: 8000 });
    err.mockRestore();
  });

  it("a second payment for an already-paid quote keeps the first payment, notes 'refund manually' and raises an approval", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ price_total: 80 });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", paidSession({ amount_total: 8000 })), { siteUrl: SITE });
    const acceptedAt = db.tables.quotes[0].accepted_at;
    const second = evt("evt_2", "checkout.session.completed", paidSession({ id: "cs_2", payment_intent: "pi_2", amount_total: 8000 }));
    expect(await handleStripeEvent(db, second, { siteUrl: SITE })).toEqual({ duplicate: false, processed: true });
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ status: "accepted", stripe_payment_intent_id: "pi_1", accepted_at: acceptedAt });
    expect(String(q.rationale)).toContain("second payment pi_2");
    expect(String(q.rationale)).toContain("refund manually");
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.fleet_tasks).toHaveLength(1);
    const [alert] = alerts(db);
    expect(alert).toMatchObject({ kind: "quote", status: "pending", ref_table: "stripe_events" });
    expect(alert.payload).toMatchObject({ quote_id: "q1", alert: "double_payment", payment_intent: "pi_2", first_payment_intent: "pi_1" });
    // Redelivery of the same events changes nothing more.
    await handleStripeEvent(db, second, { siteUrl: SITE });
    expect(String(db.tables.quotes[0].rationale).match(/pi_2/g)).toHaveLength(1);
    expect(alerts(db)).toHaveLength(1);
    err.mockRestore();
  });

  it("a redelivered event that failed half-way is retried, not treated as a duplicate", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world();
    db.tables.stripe_events = [{ id: "row-1", stripe_event_id: "evt_1", type: "checkout.session.completed", processed_at: null, payload: {} }];
    const res = await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", paidSession()), { siteUrl: SITE });
    expect(res).toEqual({ duplicate: false, processed: true });
    expect(db.tables.stripe_events).toHaveLength(1);
    expect(db.tables.quotes[0].status).toBe("accepted");
    err.mockRestore();
  });
});

describe("expireOpenCheckout", () => {
  it("expires the quote's open session and clears the stored link", async () => {
    const db = world({ stripe_checkout_id: "cs_1", stripe_checkout_url: "https://checkout.stripe.test/cs_1" });
    m.retrieve.mockResolvedValue({ id: "cs_1", status: "open" });
    m.expire.mockResolvedValue({ id: "cs_1", status: "expired" });
    expect(await expireOpenCheckout(db, "q1")).toEqual({ expired: true });
    expect(m.expire).toHaveBeenCalledWith("cs_1");
    expect(db.tables.quotes[0].stripe_checkout_url).toBeNull();
  });
  it("is a no-op on Stripe without a session or with an already expired one", async () => {
    expect(await expireOpenCheckout(world(), "q1")).toEqual({ expired: false });
    m.retrieve.mockResolvedValue({ id: "cs_1", status: "expired" });
    expect(await expireOpenCheckout(world({ stripe_checkout_id: "cs_1" }), "q1")).toEqual({ expired: false });
    expect(m.expire).not.toHaveBeenCalled();
  });
  it("refuses when the customer already paid the session (and when they pay mid-expire)", async () => {
    const db = world({ stripe_checkout_id: "cs_1", stripe_checkout_url: "u" });
    m.retrieve.mockResolvedValueOnce({ id: "cs_1", status: "complete" });
    await expect(expireOpenCheckout(db, "q1")).rejects.toThrow(/already paid/);
    expect(db.tables.quotes[0].stripe_checkout_url).toBe("u");

    m.retrieve.mockResolvedValueOnce({ id: "cs_1", status: "open" }).mockResolvedValueOnce({ id: "cs_1", status: "complete" });
    m.expire.mockRejectedValueOnce(new Error("session is complete"));
    await expect(expireOpenCheckout(db, "q1")).rejects.toThrow(/paid this quote while/);
    expect(db.tables.quotes[0].stripe_checkout_url).toBe("u");
  });
});
