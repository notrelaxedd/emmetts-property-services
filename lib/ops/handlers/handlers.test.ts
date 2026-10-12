import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  draftMessage: vi.fn(),
  createCheckout: vi.fn(),
}));
vi.mock("../../email", () => ({ sendMessage: m.sendMessage }));
vi.mock("../../ai/claude", () => ({ draftMessage: m.draftMessage }));
vi.mock("../../stripe/checkout", () => ({ createCheckoutForQuote: m.createCheckout }));

import { AUTOPILOT_KINDS } from "../../../components/admin/autopilot/kinds";
import { approvalRow, customerRow, fakeDb, jobRow, settingsRow } from "../test-utils";
import { custom_itemHandler, quoteEditLockReason, SENT_QUOTE_ERROR } from "./custom_item";
import { followupHandler } from "./followup";
import { quoteHandler } from "./quote";

const ctx = { siteUrl: "https://example.test", actor: "owner" };
const URL = "https://checkout.stripe.test/cs_1";
const PAY_URL = "https://example.test/quote/pay/q1";
const T0 = "2026-01-01T00:00:00.000Z";

const world = () =>
  fakeDb({
    quotes: [
      {
        id: "q1", created_at: T0, updated_at: T0, lead_id: "l1", customer_id: "c1", status: "needs_owner",
        price_total: 80, sent_at: null, expires_at: null, stripe_checkout_id: null,
      },
    ] as never,
    quote_items: [
      { id: "i1", quote_id: "q1", description: "Mowing", price: 50, status: "auto", sort_order: 0 },
      { id: "i2", quote_id: "q1", description: "Edging", price: 30, status: "priced", sort_order: 1 },
      { id: "i3", quote_id: "q1", description: "Tree removal", price: null, status: "referred", sort_order: 2 },
    ] as never,
    customers: [customerRow({ id: "c1", name: "Jo Smith", email: "jo@example.com" })],
    settings: [settingsRow({ quote_valid_days: 10 })],
  });
const approval = () => approvalRow({ kind: "quote", ref_table: "quotes", ref_id: "q1", status: "approved" });

beforeEach(() => {
  vi.clearAllMocks();
  m.createCheckout.mockResolvedValue({ id: "cs_1", url: URL });
  m.sendMessage.mockResolvedValue({ status: "sent", providerId: "p1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("quoteHandler", () => {
  it("creates the checkout link, emails the AI draft, and marks the quote sent", async () => {
    m.draftMessage.mockResolvedValue({ subject: "Your quote", body: `Hi Jo, pay here: ${PAY_URL}` });
    const db = world();
    await quoteHandler(db, approval(), ctx);

    expect(m.createCheckout).toHaveBeenCalledWith(db, "q1", { siteUrl: ctx.siteUrl });
    expect(m.draftMessage.mock.calls[0][1]).toMatchObject({
      kind: "quote",
      customer: { name: "Jo Smith" },
      extra: { checkout_url: PAY_URL, price_total: "$80.00", items: "Mowing: $50.00; Edging: $30.00" },
    });
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.messages[0]).toMatchObject({
      channel: "email", kind: "quote", status: "queued", quote_id: "q1", customer_id: "c1", subject: "Your quote",
    });
    expect(m.sendMessage).toHaveBeenCalledWith(db, db.tables.messages[0].id, { siteUrl: ctx.siteUrl });
    const q = db.tables.quotes[0];
    expect(q.status).toBe("sent");
    expect(q.sent_at).toBeTruthy();
    const days = (Date.parse(String(q.expires_at)) - Date.parse(String(q.sent_at))) / 86_400_000;
    expect(Math.round(days)).toBe(10);
  });

  it("appends the link if the AI draft forgot it", async () => {
    m.draftMessage.mockResolvedValue({ subject: "Quote", body: "Hi Jo, here is your quote." });
    const db = world();
    await quoteHandler(db, approval(), ctx);
    expect(String(db.tables.messages[0].body)).toContain(PAY_URL);
  });

  it("falls back to a plain-text template when the AI fails or is capped", async () => {
    m.draftMessage.mockRejectedValue(new Error("AI monthly cap reached"));
    const db = world();
    await quoteHandler(db, approval(), ctx);
    const msg = db.tables.messages[0];
    expect(msg.subject).toBe("Your quote from Emmett's Property Services");
    for (const s of ["Hi Jo,", "- Mowing: $50.00", "- Edging: $30.00", "Total: $80.00", PAY_URL, "10 days"]) {
      expect(String(msg.body)).toContain(s);
    }
    expect(String(msg.body)).not.toContain("Tree removal");
    expect(db.tables.quotes[0].status).toBe("sent");
  });

  it("does not mark the quote sent when the email is not delivered, and a retry reuses the message row", async () => {
    m.draftMessage.mockRejectedValue(new Error("nope"));
    m.sendMessage.mockResolvedValueOnce({ status: "failed", error: "provider down" });
    const db = world();
    await expect(quoteHandler(db, approval(), ctx)).rejects.toThrow(/not sent/);
    expect(db.tables.quotes[0].status).toBe("needs_owner");
    await quoteHandler(db, approval(), ctx);
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.quotes[0].status).toBe("sent");
  });

  it("skips an already accepted quote", async () => {
    const db = world();
    db.tables.quotes[0].status = "accepted";
    await quoteHandler(db, approval(), ctx);
    expect(m.createCheckout).not.toHaveBeenCalled();
    expect(m.sendMessage).not.toHaveBeenCalled();
  });
});

describe("followupHandler", () => {
  const msgDb = () =>
    fakeDb({
      messages: [{ id: "m1", customer_id: "c1", kind: "review", channel: "email", subject: "Old", body: "Old body", status: "draft" }] as never,
    });
  const fa = (payload: Record<string, unknown>) =>
    approvalRow({ kind: "followup", ref_table: "messages", ref_id: "m1", status: "approved", payload });

  it("sends the drafted message", async () => {
    const db = msgDb();
    await followupHandler(db, fa({ message_id: "m1" }), ctx);
    expect(m.sendMessage).toHaveBeenCalledWith(db, "m1", { siteUrl: ctx.siteUrl });
    expect(db.tables.messages[0]).toMatchObject({ status: "queued", subject: "Old", body: "Old body" });
  });
  it("writes owner edits to the message first", async () => {
    const db = msgDb();
    m.sendMessage.mockImplementation(async () => {
      expect(db.tables.messages[0]).toMatchObject({ subject: "New", body: "New body" });
      return { status: "sent", providerId: null };
    });
    await followupHandler(db, fa({ message_id: "m1", subject: "New", body: "New body" }), ctx);
    expect(m.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("throws on failure, tolerates cancelled, and no-ops when already sent", async () => {
    const db = msgDb();
    m.sendMessage.mockResolvedValueOnce({ status: "failed", error: "boom" });
    await expect(followupHandler(db, fa({ message_id: "m1" }), ctx)).rejects.toThrow(/boom/);
    m.sendMessage.mockResolvedValueOnce({ status: "cancelled", error: "not opted in" });
    await expect(followupHandler(db, fa({ message_id: "m1" }), ctx)).resolves.toBeUndefined();
    db.tables.messages[0].status = "sent";
    m.sendMessage.mockClear();
    await followupHandler(db, fa({ message_id: "m1" }), ctx);
    expect(m.sendMessage).not.toHaveBeenCalled();
  });
  it("requires a message id", async () => {
    await expect(followupHandler(msgDb(), approvalRow({ kind: "followup", ref_table: "x", payload: {} }), ctx)).rejects.toThrow(/message_id/);
  });
});

describe("followupHandler: stale reminder / confirmation cards", () => {
  const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 3_600_000).toISOString();
  const db = (kind: string, job: Record<string, unknown> | null) =>
    fakeDb({
      messages: [{ id: "m1", customer_id: "c1", job_id: "j1", kind, channel: "email", subject: "S", body: "B", status: "draft" }] as never,
      jobs: job ? [jobRow({ id: "j1", ...job }) as never] : [],
    });
  const fa = () => approvalRow({ kind: "followup", ref_table: "messages", ref_id: "m1", status: "approved", payload: { message_id: "m1" } });

  it("sends a reminder for a booked job that hasn't started", async () => {
    const d = db("reminder", { status: "booked", start_at: FUTURE });
    await followupHandler(d, fa(), ctx);
    expect(m.sendMessage).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["reminder", { status: "cancelled", start_at: FUTURE }, /cancelled, not booked/],
    ["reminder", { status: "proposed", start_at: FUTURE }, /proposed, not booked/],
    ["confirmation", { status: "unscheduled", start_at: null }, /unscheduled, not booked/],
    ["reminder", { status: "booked", start_at: PAST }, /start time .* has passed/],
    ["confirmation", null, /no longer exists/],
  ])("skips a %s whose job is %j: message cancelled with the reason, nothing sent", async (kind, job, why) => {
    const d = db(kind, job);
    await expect(followupHandler(d, fa(), ctx)).resolves.toBeUndefined();
    expect(m.sendMessage).not.toHaveBeenCalled();
    expect(d.tables.messages[0].status).toBe("cancelled");
    expect(String(d.tables.messages[0].error)).toMatch(why);
  });
  it("leaves other kinds (e.g. review) alone even when the job is done", async () => {
    const d = db("review", { status: "done", start_at: PAST });
    await followupHandler(d, fa(), ctx);
    expect(m.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("custom_itemHandler on a quote that has already gone out", () => {
  const seed = (status: string) =>
    fakeDb({
      settings: [settingsRow({ min_job_price: null })],
      customers: [customerRow({ id: "c1", name: "Jo Smith", email: "jo@example.com" })],
      quotes: [{ id: "q1", lead_id: "l1", customer_id: "c1", status, wage: 15, margin: 0.5, price_total: 75, labor_total: 30, rationale: null }] as never,
      quote_items: [
        { id: "i1", quote_id: "q1", description: "Mowing", is_custom: false, crew_size: 1, est_hours: 1, price: 75, status: "priced", sort_order: 0 },
        { id: "i2", quote_id: "q1", description: "Dead maple", is_custom: true, crew_size: 1, est_hours: 0, price: null, status: "needs_owner", sort_order: 1 },
      ] as never,
    });
  const ca = (payload: Record<string, unknown>) =>
    approvalRow({ kind: "custom_item", ref_table: "quote_items", ref_id: "i2", status: "approved", payload: { quote_item_id: "i2", quote_id: "q1", ...payload } });

  it.each(["sent", "accepted", "expired"])("refuses to price an item on a %s quote and changes nothing", async (status) => {
    const db = seed(status);
    const before = JSON.stringify(db.tables);
    await expect(custom_itemHandler(db, ca({ action: "price", price: 400 }), ctx)).rejects.toThrow(SENT_QUOTE_ERROR);
    expect(JSON.stringify(db.tables)).toBe(before);
  });
  it("decline still updates the item and emails the customer, but leaves the sent quote's totals and status alone", async () => {
    m.draftMessage.mockRejectedValue(new Error("no AI in tests"));
    const db = seed("sent");
    await custom_itemHandler(db, ca({ action: "decline" }), ctx);
    expect(db.tables.quote_items.find((i) => i.id === "i2")!.status).toBe("declined");
    expect(db.tables.messages[0]).toMatchObject({ kind: "decline", quote_id: "q1" });
    expect(db.tables.quotes[0]).toMatchObject({ status: "sent", price_total: 75, labor_total: 30 });
    expect(db.tables.approvals ?? []).toHaveLength(0);
  });
  it("still prices normally while the quote is needs_owner", async () => {
    const db = seed("needs_owner");
    await custom_itemHandler(db, ca({ action: "price", price: 400 }), ctx);
    expect(db.tables.quotes[0].status).toBe("draft");
    expect(db.tables.quotes[0].price_total).toBeGreaterThan(75);
  });
});

describe("quoteEditLockReason (saveQuote's lock)", () => {
  it("locks sent / accepted / declined quotes and points at the right way out", () => {
    expect(quoteEditLockReason("sent")).toMatch(/Revise & re-send/);
    expect(quoteEditLockReason("accepted")).toMatch(/Refund/);
    expect(quoteEditLockReason("declined")).toMatch(/can't be edited/);
    for (const s of ["draft", "needs_owner", "expired"] as const) expect(quoteEditLockReason(s)).toBeNull();
  });
});

describe("autopilot switches", () => {
  it("has no custom_item switch (custom requests are never autopiloted) but every other kind", () => {
    const kinds = AUTOPILOT_KINDS.map((k) => k.kind as string);
    expect(kinds).not.toContain("custom_item");
    expect(kinds.sort()).toEqual(["ad", "booking", "crew_change", "drop", "followup", "quote", "weather_hold"]);
  });
});
