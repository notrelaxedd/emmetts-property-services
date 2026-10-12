import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  draftMessage: vi.fn(),
  createCheckout: vi.fn(),
}));
vi.mock("../../email", () => ({ sendMessage: m.sendMessage }));
vi.mock("../../ai/claude", () => ({ draftMessage: m.draftMessage }));
vi.mock("../../stripe/checkout", () => ({ createCheckoutForQuote: m.createCheckout }));

import { approvalRow, customerRow, fakeDb, settingsRow } from "../test-utils";
import { followupHandler } from "./followup";
import { quoteHandler } from "./quote";

const ctx = { siteUrl: "https://example.test", actor: "owner" };
const URL = "https://checkout.stripe.test/cs_1";
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
    m.draftMessage.mockResolvedValue({ subject: "Your quote", body: `Hi Jo, pay here: ${URL}` });
    const db = world();
    await quoteHandler(db, approval(), ctx);

    expect(m.createCheckout).toHaveBeenCalledWith(db, "q1", { siteUrl: ctx.siteUrl });
    expect(m.draftMessage.mock.calls[0][1]).toMatchObject({
      kind: "quote",
      customer: { name: "Jo Smith" },
      extra: { checkout_url: URL, price_total: "$80.00", items: "Mowing: $50.00; Edging: $30.00" },
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
    expect(String(db.tables.messages[0].body)).toContain(URL);
  });

  it("falls back to a plain-text template when the AI fails or is capped", async () => {
    m.draftMessage.mockRejectedValue(new Error("AI monthly cap reached"));
    const db = world();
    await quoteHandler(db, approval(), ctx);
    const msg = db.tables.messages[0];
    expect(msg.subject).toBe("Your quote from Emmett's Property Services");
    for (const s of ["Hi Jo,", "- Mowing: $50.00", "- Edging: $30.00", "Total: $80.00", URL, "10 days"]) {
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
