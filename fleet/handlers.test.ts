/** Tests for the two approval handlers this phase owns: lib/ops/handlers/{ad,custom_item}.ts. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ai/claude", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/ai/claude")>();
  return { ...real, draftMessage: vi.fn(async () => { throw new Error("no AI in tests"); }) };
});

import { adHandler } from "../lib/ops/handlers/ad";
import { custom_itemHandler } from "../lib/ops/handlers/custom_item";
import { approvalRow, customerRow, settingsRow } from "../lib/ops/test-utils";
import { priceItem } from "../lib/pricing";
import { fleetDb } from "./test-helpers";

const T0 = "2026-01-01T00:00:00.000Z";
const ctx = { siteUrl: "https://eod.test", actor: "owner" };
const item = (id: string, over: Record<string, unknown>) => ({
  id, created_at: T0, updated_at: T0, quote_id: "q1", service_id: null, description: id, is_custom: false, crew_size: 2,
  est_hours: 1, price: null, status: "auto", partner_note: null, ai_summary: null, sort_order: 0, ...over,
});

function seed(settingsOver = {}) {
  const s = settingsRow({ min_job_price: null, ...settingsOver });
  return fleetDb({
    settings: [s],
    customers: [customerRow({ id: "c1", name: "Pat Smith", email: "pat@x.test" })],
    quotes: [{ id: "q1", lead_id: "l1", customer_id: "c1", status: "needs_owner", wage: 15, margin: 0.5, price_total: 60, rationale: "why", created_at: T0 } as never],
    quote_items: [
      item("Leaf cleanup", { price: priceItem({ crew_size: 2, est_hours: 1 }, s).price }) as never,
      item("Dead maple", { is_custom: true, status: "needs_owner", crew_size: 1, est_hours: 0, sort_order: 100 }) as never,
    ],
  });
}
const approval = (payload: Record<string, unknown>) =>
  approvalRow({ kind: "custom_item", ref_table: "quote_items", ref_id: "Dead maple", status: "approved", payload: { quote_item_id: "Dead maple", quote_id: "q1", ...payload } });

describe("custom_item handler", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("price: sets the owner's numbers, re-totals, and puts the job on the schedule's rail (no pay-link card)", async () => {
    const db = seed();
    await custom_itemHandler(db, approval({ action: "price", price: "450", est_hours: 5, crew_size: 3 }), ctx);
    expect(db.tables.quote_items.find((i) => i.id === "Dead maple")).toMatchObject({ status: "priced", price: 450, est_hours: 5, crew_size: 3 });
    expect(db.tables.quotes[0]).toMatchObject({ status: "draft", price_total: 510, labor_total: 30 + 225 });
    expect(db.tables.approvals ?? []).toHaveLength(0);
    // Leaf cleanup 2 crew × 1 h + dead maple 3 crew × 5 h → 360 min, crew 3; unpaid, waiting for a day.
    expect(db.tables.jobs).toHaveLength(1);
    expect(db.tables.jobs[0]).toMatchObject({ quote_id: "q1", customer_id: "c1", status: "unscheduled", paid: false, est_minutes: 360, crew_size: 3 });
  });

  it("price is the default action when a price is given; a missing action is an error", async () => {
    const db = seed();
    await custom_itemHandler(db, approval({ price: 100 }), ctx);
    expect(db.tables.quote_items.find((i) => i.id === "Dead maple")!.status).toBe("priced");
    await expect(custom_itemHandler(seed(), approval({}), ctx)).rejects.toThrow(/needs payload.action/);
  });

  it("refer: marks referred and emails the customer (template names the partner when set)", async () => {
    const db = seed({ partner_tree_service_name: "Oak & Sons" });
    await custom_itemHandler(db, approval({ action: "refer", partner_note: "Ask for Joe" }), ctx);
    expect(db.tables.quote_items.find((i) => i.id === "Dead maple")).toMatchObject({ status: "referred", partner_note: "Ask for Joe" });
    const msg = db.tables.messages[0];
    expect(msg).toMatchObject({ kind: "referral", quote_id: "q1", status: "sent" });
    expect(String(msg.body)).toMatch(/Oak & Sons/);
    expect(db.tables.quotes[0]).toMatchObject({ status: "draft", price_total: 60 });
    expect(db.tables.approvals ?? []).toHaveLength(0);
    expect(db.tables.jobs[0]).toMatchObject({ status: "unscheduled", paid: false, est_minutes: 60, crew_size: 2 }); // the leaf cleanup alone
  });

  it("refer without a partner name says 'a trusted partner'; decline sends a decline email", async () => {
    const db = seed();
    await custom_itemHandler(db, approval({ action: "refer" }), ctx);
    expect(String(db.tables.messages[0].body)).toMatch(/a trusted partner/);
    const db2 = seed();
    await custom_itemHandler(db2, approval({ action: "decline" }), ctx);
    expect(db2.tables.quote_items.find((i) => i.id === "Dead maple")!.status).toBe("declined");
    expect(db2.tables.messages[0]).toMatchObject({ kind: "decline", status: "sent" });
  });

  it("declining the only item declines the quote; other open items keep it waiting", async () => {
    const db = seed();
    db.tables.quote_items.splice(0, 1); // custom item only
    await custom_itemHandler(db, approval({ action: "decline" }), ctx);
    expect(db.tables.quotes[0].status).toBe("declined");
    expect(db.tables.approvals ?? []).toHaveLength(0);

    const db2 = seed();
    db2.tables.quote_items.push(item("Gutters", { status: "needs_owner", service_id: "svc" }) as never);
    await custom_itemHandler(db2, approval({ action: "price", price: 200 }), ctx);
    expect(db2.tables.quotes[0].status).toBe("needs_owner");
    expect(db2.tables.approvals ?? []).toHaveLength(0);
  });
});

describe("ad handler", () => {
  it("marks the ad approved and keeps the owner's edits", async () => {
    const db = fleetDb({ ads: [{ id: "ad1", status: "draft", headline: "Old", body: "Old body", cta: "Go" } as never] });
    await adHandler(db, approvalRow({ kind: "ad", ref_table: "ads", ref_id: "ad1", status: "edited", payload: { ad_id: "ad1", headline: "New headline" } }), ctx);
    expect(db.tables.ads[0]).toMatchObject({ status: "approved", headline: "New headline", body: "Old body" });
  });
});
