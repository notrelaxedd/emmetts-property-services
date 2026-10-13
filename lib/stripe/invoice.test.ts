/** Stripe Invoicing, Stripe Tax and the invoice webhook events, against a mocked `stripe` SDK. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  refundCreate: vi.fn(),
  customerList: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceRetrieve: vi.fn(),
  invoiceFinalize: vi.fn(),
  invoiceSend: vi.fn(),
  invoiceVoid: vi.fn(),
  invoiceDel: vi.fn(),
  itemCreate: vi.fn(),
  paymentsList: vi.fn(),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    static API_VERSION = "2026-09-30.endive";
    checkout = { sessions: { create: m.sessionCreate, retrieve: m.sessionRetrieve, expire: m.sessionExpire } };
    refunds = { create: m.refundCreate };
    customers = { list: m.customerList, create: m.customerCreate, update: m.customerUpdate };
    invoices = {
      create: m.invoiceCreate,
      retrieve: m.invoiceRetrieve,
      finalizeInvoice: m.invoiceFinalize,
      sendInvoice: m.invoiceSend,
      voidInvoice: m.invoiceVoid,
      del: m.invoiceDel,
    };
    invoiceItems = { create: m.itemCreate };
    invoicePayments = { list: m.paymentsList };
    constructor(public key: string) {}
  }
  return { default: FakeStripe };
});

import type Stripe from "stripe";
import { customerRow, fakeDb, jobRow, settingsRow } from "../ops/test-utils";
import { billedLines, createCheckoutForQuote, refundQuote } from "./checkout";
import { resetStripeClient } from "./client";
import { createInvoiceForQuote, voidInvoiceForQuote } from "./invoice";
import { parseUsAddress, taxConfig } from "./tax";
import { handleStripeEvent } from "./webhook";

const SITE = "https://www.eodlawns.com";
const T0 = "2026-01-01T00:00:00.000Z";
const ADDRESS = "19000 Lake Rd, Rocky River, OH 44116";

const item = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), created_at: T0, updated_at: T0, quote_id: "q1", service_id: null, description: "Mowing",
  is_custom: false, crew_size: 1, est_hours: 1, price: 50, status: "auto", partner_note: null, ai_summary: null,
  sort_order: 0, ...over,
});
const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1", created_at: T0, updated_at: T0, lead_id: "l1", customer_id: "c1", status: "draft", price_total: 80,
  labor_total: 0, fee_total: 0, profit_total: 0, margin: 0.5, wage: 15, stripe_checkout_id: null,
  stripe_checkout_url: null, stripe_payment_intent_id: null, stripe_invoice_id: null, stripe_invoice_url: null,
  sent_at: null, accepted_at: null, expires_at: "2026-02-01T00:00:00.000Z", rationale: null, ...over,
});
const world = (q: Record<string, unknown> = {}, c: Record<string, unknown> = {}) =>
  fakeDb({
    quotes: [quote(q)] as never,
    quote_items: [item({ description: "Mowing", price: 50 }), item({ description: "Edging", price: 30, sort_order: 1 })] as never,
    customers: [customerRow({ id: "c1", email: "jo@example.com", name: "Jo Smith", phone: "4405550100", address: ADDRESS, ...c })],
    leads: [{ id: "l1", status: "quoted" }] as never,
    settings: [settingsRow()],
  });

const HOSTED = "https://invoice.stripe.test/i/in_1";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  delete process.env.STRIPE_TAX_ENABLED;
  delete process.env.STRIPE_TAX_CODE;
  resetStripeClient();
  m.sessionCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
  m.customerList.mockResolvedValue({ data: [], has_more: false });
  m.customerCreate.mockResolvedValue({ id: "cus_new" });
  m.invoiceCreate.mockResolvedValue({ id: "in_1", status: "draft" });
  m.itemCreate.mockResolvedValue({ id: "ii_x" });
  m.invoiceFinalize.mockResolvedValue({ id: "in_1", status: "open", hosted_invoice_url: HOSTED });
  m.invoiceSend.mockResolvedValue({ id: "in_1", status: "open" });
});
afterEach(() => {
  delete process.env.STRIPE_TAX_ENABLED;
  delete process.env.STRIPE_TAX_CODE;
});

describe("taxConfig / parseUsAddress / billedLines", () => {
  it("tax is off unless STRIPE_TAX_ENABLED=true; STRIPE_TAX_CODE is optional", () => {
    expect(taxConfig({})).toEqual({ enabled: false, taxCode: undefined });
    expect(taxConfig({ STRIPE_TAX_ENABLED: "1" }).enabled).toBe(false);
    expect(taxConfig({ STRIPE_TAX_ENABLED: "TRUE ", STRIPE_TAX_CODE: " txcd_X " })).toEqual({ enabled: true, taxCode: "txcd_X" });
    expect(taxConfig({ STRIPE_TAX_CODE: "  " }).taxCode).toBeUndefined();
  });
  it("splits a one-line US address for Stripe", () => {
    expect(parseUsAddress(ADDRESS)).toEqual({ line1: "19000 Lake Rd", city: "Rocky River", state: "OH", postal_code: "44116", country: "US" });
    expect(parseUsAddress("19000 Lake Rd, Rocky River OH 44116-1234, USA")).toMatchObject({ city: "Rocky River", state: "OH", postal_code: "44116" });
    expect(parseUsAddress("19000 Lake Rd")).toEqual({ line1: "19000 Lake Rd", country: "US" });
    expect(parseUsAddress(null)).toBeNull();
  });
  it("billedLines returns description / cents / quantity with the minimum-job adjustment", () => {
    expect(billedLines({ price_total: 100 }, [item({ price: 50 }), item({ description: "Declined", price: 9, status: "declined" })] as never)).toEqual([
      { description: "Mowing", unit_amount_cents: 5000, quantity: 1 },
      { description: "Minimum job adjustment", unit_amount_cents: 5000, quantity: 1 },
    ]);
  });
});

describe("Stripe Tax on Checkout", () => {
  it("off: no automatic_tax / address collection, lines are tax-exclusive without a tax code", async () => {
    await createCheckoutForQuote(world({ status: "sent" }), "q1", { siteUrl: SITE });
    const params = m.sessionCreate.mock.calls[0][0];
    expect(params.automatic_tax).toBeUndefined();
    expect(params.billing_address_collection).toBeUndefined();
    expect(params.line_items[0].price_data).toEqual({ currency: "usd", unit_amount: 5000, tax_behavior: "exclusive", product_data: { name: "Mowing" } });
  });
  it("on: automatic_tax + required billing address; STRIPE_TAX_CODE goes on every product", async () => {
    process.env.STRIPE_TAX_ENABLED = "true";
    process.env.STRIPE_TAX_CODE = "txcd_test_landscaping";
    await createCheckoutForQuote(world({ status: "sent" }), "q1", { siteUrl: SITE });
    const params = m.sessionCreate.mock.calls[0][0];
    expect(params).toMatchObject({ automatic_tax: { enabled: true }, billing_address_collection: "required", customer_email: "jo@example.com" });
    for (const l of params.line_items) {
      expect(l.price_data.tax_behavior).toBe("exclusive");
      expect(l.price_data.product_data.tax_code).toBe("txcd_test_landscaping");
    }
  });
  it("turning tax on changes the session hash (a fresh session, not the untaxed one)", async () => {
    await createCheckoutForQuote(world({ status: "sent" }), "q1", { siteUrl: SITE });
    process.env.STRIPE_TAX_ENABLED = "true";
    await createCheckoutForQuote(world({ status: "sent" }), "q1", { siteUrl: SITE });
    expect(m.sessionCreate.mock.calls[0][0].metadata.items_hash).not.toBe(m.sessionCreate.mock.calls[1][0].metadata.items_hash);
  });
  it("refuses to mint a Checkout session while the quote has an open invoice", async () => {
    await expect(createCheckoutForQuote(world({ status: "sent", stripe_invoice_url: HOSTED }), "q1", { siteUrl: SITE })).rejects.toThrow(/open Stripe invoice/);
  });
});

const evt = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

describe("webhook: taxed Checkout payments", () => {
  const session = (over: Record<string, unknown> = {}) => ({
    id: "cs_1", payment_status: "paid", payment_intent: "pi_1", metadata: { quote_id: "q1" }, ...over,
  });
  it("compares amount_subtotal (pre-tax) with price_total and notes the sales tax; price_total stays pre-tax", async () => {
    const db = world({ status: "sent" });
    const s = session({ automatic_tax: { enabled: true }, amount_subtotal: 8000, amount_total: 8640, total_details: { amount_tax: 640 } });
    expect(await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", s), { siteUrl: SITE })).toEqual({ duplicate: false, processed: true });
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({ status: "accepted", price_total: 80, stripe_payment_intent_id: "pi_1" });
    expect(String(q.rationale)).toMatch(/Sales tax collected: \$6\.40 \(checkout cs_1\)/);
    expect(String(q.rationale)).not.toMatch(/differs/);
    expect(db.tables.approvals ?? []).toHaveLength(0);
    expect(db.tables.jobs).toHaveLength(1);
  });
  it("untaxed sessions still compare amount_total", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ status: "sent" });
    const s = session({ automatic_tax: { enabled: false }, amount_subtotal: 8000, amount_total: 8640, total_details: { amount_tax: 0 } });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", s), { siteUrl: SITE });
    expect(String(db.tables.quotes[0].rationale)).toMatch(/customer paid \$86\.40 but the quote total is \$80\.00/);
    expect(String(db.tables.quotes[0].rationale)).not.toMatch(/Sales tax/);
    err.mockRestore();
  });
  it("a taxed subtotal that differs is flagged as 'before tax'", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ status: "sent" });
    const s = session({ automatic_tax: { enabled: true }, amount_subtotal: 7000, amount_total: 7560, total_details: { amount_tax: 560 } });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", s), { siteUrl: SITE });
    const r = String(db.tables.quotes[0].rationale);
    expect(r).toMatch(/customer paid \$70\.00 before tax but the quote total is \$80\.00/);
    expect(r).toMatch(/Sales tax collected: \$5\.60/);
    expect(db.tables.approvals[0].payload).toMatchObject({ alert: "amount_mismatch", amount_paid: 7000, amount_expected: 8000 });
    err.mockRestore();
  });
  it("falls back to STRIPE_TAX_ENABLED when the payload has no automatic_tax field", async () => {
    process.env.STRIPE_TAX_ENABLED = "true";
    const db = world({ status: "sent" });
    await handleStripeEvent(db, evt("evt_1", "checkout.session.completed", session({ amount_subtotal: 8000, amount_total: 8640 })), { siteUrl: SITE });
    expect(String(db.tables.quotes[0].rationale ?? "")).not.toMatch(/differs/);
  });
});

describe("createInvoiceForQuote", () => {
  it("creates the Stripe customer, a send_invoice draft, one item per billed line, finalizes, sends and stores id/url", async () => {
    const db = world();
    const res = await createInvoiceForQuote(db, "q1", { siteUrl: `${SITE}/`, daysUntilDue: 14, sendInvoice: true });
    expect(res).toEqual({ id: "in_1", hosted_invoice_url: HOSTED });

    expect(m.customerList).toHaveBeenCalledWith({ email: "jo@example.com", limit: 1 });
    const [cust, custOpts] = m.customerCreate.mock.calls[0];
    expect(cust).toMatchObject({
      name: "Jo Smith", email: "jo@example.com", phone: "4405550100",
      address: { line1: "19000 Lake Rd", city: "Rocky River", state: "OH", postal_code: "44116", country: "US" },
      metadata: { customer_id: "c1" },
    });
    expect(custOpts).toEqual({ idempotencyKey: "customer-c1" });
    expect(db.tables.customers[0].stripe_customer_id).toBe("cus_new");

    const [inv] = m.invoiceCreate.mock.calls[0];
    expect(inv).toMatchObject({
      customer: "cus_new", collection_method: "send_invoice", days_until_due: 14, auto_advance: false,
      pending_invoice_items_behavior: "exclude", automatic_tax: { enabled: false },
      metadata: { quote_id: "q1", customer_id: "c1" },
    });
    expect(inv.footer).toContain(SITE);
    expect(m.itemCreate.mock.calls.map(([p]) => [p.description, p.amount, p.invoice, p.tax_behavior, p.tax_code])).toEqual([
      ["Mowing", 5000, "in_1", "exclusive", undefined],
      ["Edging", 3000, "in_1", "exclusive", undefined],
    ]);
    expect(m.itemCreate.mock.calls.map(([, o]) => o.idempotencyKey)).toEqual(["invoice-in_1-line-0", "invoice-in_1-line-1"]);
    expect(m.invoiceFinalize).toHaveBeenCalledWith("in_1", { auto_advance: false });
    expect(m.invoiceSend).toHaveBeenCalledWith("in_1");
    expect(db.tables.quotes[0]).toMatchObject({ stripe_invoice_id: "in_1", stripe_invoice_url: HOSTED, status: "sent", expires_at: null });
    expect(db.tables.quotes[0].sent_at).toBeTruthy();
  });

  it("reuses an existing Stripe customer found by email (and fills in its address), and the stored id after that", async () => {
    m.customerList.mockResolvedValue({ data: [{ id: "cus_old", address: null }], has_more: false });
    const db = world();
    await createInvoiceForQuote(db, "q1", { siteUrl: SITE, daysUntilDue: 7 });
    expect(m.customerCreate).not.toHaveBeenCalled();
    expect(m.customerUpdate).toHaveBeenCalledWith("cus_old", { address: expect.objectContaining({ postal_code: "44116" }) });
    expect(m.invoiceCreate.mock.calls[0][0].customer).toBe("cus_old");
    expect(m.invoiceSend).not.toHaveBeenCalled(); // sendInvoice not requested

    const db2 = world({}, { stripe_customer_id: "cus_stored" });
    await createInvoiceForQuote(db2, "q1", { siteUrl: SITE, daysUntilDue: 7 });
    expect(m.customerList).toHaveBeenCalledTimes(1);
    expect(m.invoiceCreate.mock.calls[1][0].customer).toBe("cus_stored");
  });

  it("with tax on: automatic_tax, tax-exclusive items with STRIPE_TAX_CODE; refuses without a ZIP", async () => {
    process.env.STRIPE_TAX_ENABLED = "true";
    process.env.STRIPE_TAX_CODE = "txcd_test_landscaping";
    await createInvoiceForQuote(world(), "q1", { siteUrl: SITE, daysUntilDue: 7 });
    expect(m.invoiceCreate.mock.calls[0][0].automatic_tax).toEqual({ enabled: true });
    expect(m.itemCreate.mock.calls.every(([p]) => p.tax_code === "txcd_test_landscaping" && p.tax_behavior === "exclusive")).toBe(true);

    vi.clearAllMocks();
    await expect(createInvoiceForQuote(world({}, { address: "19000 Lake Rd" }), "q1", { siteUrl: SITE, daysUntilDue: 7 })).rejects.toThrow(/ZIP/);
    expect(m.invoiceCreate).not.toHaveBeenCalled();
  });

  it("is idempotent: an open invoice for the same lines is returned (and re-sent on request), not duplicated", async () => {
    const db = world();
    await createInvoiceForQuote(db, "q1", { siteUrl: SITE, daysUntilDue: 7, sendInvoice: true });
    const hash = m.invoiceCreate.mock.calls[0][0].metadata.items_hash;
    m.invoiceRetrieve.mockResolvedValue({ id: "in_1", status: "open", hosted_invoice_url: HOSTED, metadata: { items_hash: hash } });
    const again = await createInvoiceForQuote(db, "q1", { siteUrl: SITE, daysUntilDue: 7, sendInvoice: true });
    expect(again).toEqual({ id: "in_1", hosted_invoice_url: HOSTED });
    expect(m.invoiceCreate).toHaveBeenCalledTimes(1);
    expect(m.invoiceSend).toHaveBeenCalledTimes(2);
    expect(m.invoiceVoid).not.toHaveBeenCalled();
  });

  it("voids an open invoice for different lines / terms and creates a new one with a fresh idempotency key", async () => {
    const db = world({ status: "sent", stripe_invoice_id: "in_old", stripe_invoice_url: "https://invoice.stripe.test/old" });
    m.invoiceRetrieve.mockResolvedValue({ id: "in_old", status: "open", hosted_invoice_url: "x", metadata: { items_hash: "stale" } });
    await createInvoiceForQuote(db, "q1", { siteUrl: SITE, daysUntilDue: 30 });
    expect(m.invoiceVoid).toHaveBeenCalledWith("in_old");
    expect(m.invoiceCreate.mock.calls[0][1].idempotencyKey).toMatch(/^quote-invoice-q1-[0-9a-f]{16}-in_old$/);
    expect(db.tables.quotes[0]).toMatchObject({ stripe_invoice_id: "in_1", stripe_invoice_url: HOSTED });
  });

  it("deletes a leftover draft, refuses a paid invoice, and expires an open Checkout session first", async () => {
    m.invoiceRetrieve.mockResolvedValueOnce({ id: "in_draft", status: "draft", metadata: {} });
    await createInvoiceForQuote(world({ stripe_invoice_id: "in_draft" }), "q1", { siteUrl: SITE, daysUntilDue: 7 });
    expect(m.invoiceDel).toHaveBeenCalledWith("in_draft");

    m.invoiceRetrieve.mockResolvedValueOnce({ id: "in_paid", status: "paid", metadata: {} });
    await expect(createInvoiceForQuote(world({ stripe_invoice_id: "in_paid" }), "q1", { siteUrl: SITE, daysUntilDue: 7 })).rejects.toThrow(/already paid/);

    const db = world({ status: "sent", stripe_checkout_id: "cs_1", stripe_checkout_url: "https://checkout.stripe.test/cs_1" });
    m.sessionRetrieve.mockResolvedValue({ id: "cs_1", status: "open" });
    m.sessionExpire.mockResolvedValue({ id: "cs_1", status: "expired" });
    await createInvoiceForQuote(db, "q1", { siteUrl: SITE, daysUntilDue: 7 });
    expect(m.sessionExpire).toHaveBeenCalledWith("cs_1");
    expect(db.tables.quotes[0].stripe_checkout_url).toBeNull();

    // A paid Checkout session blocks the invoice before anything is created.
    vi.clearAllMocks();
    m.sessionRetrieve.mockResolvedValue({ id: "cs_1", status: "complete" });
    await expect(createInvoiceForQuote(world({ stripe_checkout_id: "cs_1" }), "q1", { siteUrl: SITE, daysUntilDue: 7 })).rejects.toThrow(/already paid/);
    expect(m.invoiceCreate).not.toHaveBeenCalled();
  });

  it("validates days until due, the email, and the quote status", async () => {
    await expect(createInvoiceForQuote(world(), "q1", { siteUrl: SITE, daysUntilDue: 0 })).rejects.toThrow(/days until due/);
    await expect(createInvoiceForQuote(world({}, { email: null }), "q1", { siteUrl: SITE, daysUntilDue: 7 })).rejects.toThrow(/no email/);
    await expect(createInvoiceForQuote(world({ status: "accepted" }), "q1", { siteUrl: SITE, daysUntilDue: 7 })).rejects.toThrow(/accepted/);
  });
});

describe("voidInvoiceForQuote", () => {
  it("voids an open invoice and clears the URL but keeps the id", async () => {
    const db = world({ status: "sent", stripe_invoice_id: "in_1", stripe_invoice_url: HOSTED });
    m.invoiceRetrieve.mockResolvedValue({ id: "in_1", status: "open" });
    m.invoiceVoid.mockResolvedValue({ id: "in_1", status: "void" });
    expect(await voidInvoiceForQuote(db, "q1")).toEqual({ voided: true });
    expect(db.tables.quotes[0]).toMatchObject({ stripe_invoice_id: "in_1", stripe_invoice_url: null, status: "sent" });
  });
  it("refuses a paid invoice (also when it is paid mid-void)", async () => {
    const db = world({ status: "sent", stripe_invoice_id: "in_1", stripe_invoice_url: HOSTED });
    m.invoiceRetrieve.mockResolvedValueOnce({ id: "in_1", status: "paid" });
    await expect(voidInvoiceForQuote(db, "q1")).rejects.toThrow(/already paid/);
    m.invoiceRetrieve.mockResolvedValueOnce({ id: "in_1", status: "open" }).mockResolvedValueOnce({ id: "in_1", status: "paid" });
    m.invoiceVoid.mockRejectedValueOnce(new Error("invoice is paid"));
    await expect(voidInvoiceForQuote(db, "q1")).rejects.toThrow(/paid this invoice while/);
    expect(db.tables.quotes[0].stripe_invoice_url).toBe(HOSTED);
  });
  it("is a no-op without an invoice", async () => {
    expect(await voidInvoiceForQuote(world(), "q1")).toEqual({ voided: false });
    expect(m.invoiceRetrieve).not.toHaveBeenCalled();
  });
});

const paidInvoice = (over: Record<string, unknown> = {}) => ({
  id: "in_1", object: "invoice", status: "paid", metadata: { quote_id: "q1", customer_id: "c1" },
  automatic_tax: { enabled: false }, subtotal: 8000, total: 8000, total_excluding_tax: 8000, amount_paid: 8000,
  amount_due: 8000, amount_remaining: 0, attempt_count: 1, total_taxes: [],
  payments: { object: "list", data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_inv" } }] },
  ...over,
});

describe("webhook: invoice events", () => {
  const sentByInvoice = () => world({ status: "sent", stripe_invoice_id: "in_1", stripe_invoice_url: HOSTED, expires_at: null });

  it("invoice.paid runs the Checkout accept path: accepted, PaymentIntent stored, lead won, job created", async () => {
    const db = sentByInvoice();
    expect(await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice()), { siteUrl: SITE })).toEqual({ duplicate: false, processed: true });
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", stripe_payment_intent_id: "pi_inv", rationale: null });
    expect(db.tables.quotes[0].accepted_at).toBeTruthy();
    expect(db.tables.leads[0].status).toBe("won");
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.fleet_tasks.map((t) => t.type)).toEqual(["schedule"]);
    expect(m.paymentsList).not.toHaveBeenCalled();
  });

  it("looks the PaymentIntent up via InvoicePayments when the payload doesn't include it, and reads the legacy field", async () => {
    m.paymentsList.mockResolvedValue({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_listed" } }] });
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice({ payments: undefined })), { siteUrl: SITE });
    expect(m.paymentsList).toHaveBeenCalledWith({ invoice: "in_1", status: "paid", limit: 10 });
    expect(db.tables.quotes[0].stripe_payment_intent_id).toBe("pi_listed");

    const legacy = sentByInvoice();
    await handleStripeEvent(legacy, evt("evt_2", "invoice.paid", paidInvoice({ payments: undefined, payment_intent: "pi_legacy" })), { siteUrl: SITE });
    expect(legacy.tables.quotes[0].stripe_payment_intent_id).toBe("pi_legacy");
  });

  it("an invoice marked paid outside Stripe is accepted without a PaymentIntent", async () => {
    m.paymentsList.mockResolvedValue({ data: [] });
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice({ payments: undefined })), { siteUrl: SITE });
    expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", stripe_payment_intent_id: null });
  });

  it("leaves the event unprocessed (for retry) when the PaymentIntent lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.paymentsList.mockRejectedValue(new Error("stripe down"));
    const db = sentByInvoice();
    const res = await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice({ payments: undefined })), { siteUrl: SITE });
    expect(res.processed).toBe(false);
    expect(db.tables.quotes[0].status).toBe("sent");
    err.mockRestore();
  });

  it("taxed invoice: compares the pre-tax amount and notes the tax collected", async () => {
    const db = sentByInvoice();
    const inv = paidInvoice({
      automatic_tax: { enabled: true }, total: 8640, amount_paid: 8640, total_excluding_tax: 8000,
      total_taxes: [{ amount: 460 }, { amount: 180 }],
    });
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", inv), { siteUrl: SITE });
    const r = String(db.tables.quotes[0].rationale);
    expect(r).toMatch(/Sales tax collected: \$6\.40 \(invoice in_1\)/);
    expect(r).not.toMatch(/differs/);
    expect(db.tables.quotes[0].price_total).toBe(80);
  });

  it("a second payment (Checkout already paid, then the invoice) keeps the first and raises the refund alert", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ status: "accepted", stripe_payment_intent_id: "pi_checkout", stripe_invoice_id: "in_1" });
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice()), { siteUrl: SITE });
    expect(db.tables.quotes[0].stripe_payment_intent_id).toBe("pi_checkout");
    expect(String(db.tables.quotes[0].rationale)).toMatch(/second payment pi_inv .*invoice in_1.*refund manually/);
    expect(db.tables.approvals[0].payload).toMatchObject({ alert: "double_payment", invoice: "in_1", payment_intent: "pi_inv" });
    err.mockRestore();
  });

  it("invoice.payment_failed notes the quote once", async () => {
    const db = sentByInvoice();
    const inv = paidInvoice({ status: "open", attempt_count: 2, amount_due: 8000 });
    await handleStripeEvent(db, evt("evt_1", "invoice.payment_failed", inv), { siteUrl: SITE });
    await handleStripeEvent(db, evt("evt_2", "invoice.payment_failed", inv), { siteUrl: SITE });
    const r = String(db.tables.quotes[0].rationale);
    expect(r).toMatch(/Invoice in_1 payment failed \(attempt 2, \$80\.00 due\)/);
    expect(r.match(/payment failed/g)).toHaveLength(1);
    expect(db.tables.quotes[0].status).toBe("sent");
  });

  it("invoice.voided in Stripe declines a still-sent quote; our own void (URL already cleared) is ignored", async () => {
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.voided", paidInvoice({ status: "void" })), { siteUrl: SITE });
    expect(db.tables.quotes[0]).toMatchObject({ status: "declined", stripe_invoice_url: null });
    expect(String(db.tables.quotes[0].rationale)).toMatch(/Invoice in_1 was voided in Stripe\. Quote marked declined\./);

    const ours = world({ status: "sent", stripe_invoice_id: "in_1", stripe_invoice_url: null, stripe_checkout_url: "https://checkout.stripe.test/cs_2" });
    await handleStripeEvent(ours, evt("evt_2", "invoice.voided", paidInvoice({ status: "void" })), { siteUrl: SITE });
    expect(ours.tables.quotes[0]).toMatchObject({ status: "sent", rationale: null });
  });

  it("invoice.marked_uncollectible notes the quote and leaves its status", async () => {
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.marked_uncollectible", paidInvoice({ status: "uncollectible", amount_remaining: 8000 })), { siteUrl: SITE });
    expect(db.tables.quotes[0].status).toBe("sent");
    expect(String(db.tables.quotes[0].rationale)).toMatch(/marked uncollectible in Stripe \(\$80\.00 unpaid\)/);
  });

  it("refundQuote refunds an invoice-paid quote through its PaymentIntent", async () => {
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice()), { siteUrl: SITE });
    m.refundCreate.mockResolvedValue({ id: "re_1", charge: "ch_1" });
    const res = await refundQuote(db, "q1", { reason: "moved away" });
    expect(res).toEqual({ refundId: "re_1", jobCancelled: true });
    expect(m.refundCreate.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_inv" });
    expect(db.tables.quotes[0].status).toBe("declined");
  });

  it("ignores invoices that aren't ours", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = sentByInvoice();
    await handleStripeEvent(db, evt("evt_1", "invoice.paid", paidInvoice({ metadata: {} })), { siteUrl: SITE });
    expect(db.tables.quotes[0].status).toBe("sent");
    warn.mockRestore();
  });
});

describe("refundQuote with an old job", () => {
  it("still refuses a done job for invoice-paid quotes", async () => {
    const db = world({ status: "accepted", stripe_payment_intent_id: "pi_inv", stripe_invoice_id: "in_1" });
    db.tables.jobs = [jobRow({ id: "j1", quote_id: "q1", status: "done" }) as never];
    await expect(refundQuote(db, "q1", { reason: "x" })).rejects.toThrow(/cannot be cancelled/);
  });
});
