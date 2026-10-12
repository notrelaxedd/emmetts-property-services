import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/geo", () => ({
  geocode: vi.fn(async () => ({ lat: 41.48, lng: -81.84, formatted: "1 Lake Rd, Rocky River, OH" })),
  lookupParcel: vi.fn(async () => ({ parcel_id: "301-01-001", lot_acres: 0.5, source: "test" })),
}));

import type { Service } from "../../lib/db/types";
import { geocode, lookupParcel } from "../../lib/geo";
import { registerApprovalHandler } from "../../lib/ops/approvals";
import { customerRow, settingsRow } from "../../lib/ops/test-utils";
import { estimateHours, priceItem, priceQuote } from "../../lib/pricing";
import { fleetDb, makeCtx } from "../test-helpers";
import { runQuote } from "./quote";

const T0 = "2026-01-01T00:00:00.000Z";
const rule = { base: 30, per_acre: 60, tree_cover: { none: 1, light: 1.2, medium: 1.5, heavy: 2 } };
function service(id: string, name: string, over: Partial<Service> = {}): Service {
  return {
    id, created_at: T0, updated_at: T0, slug: id, name, active: true, auto_quote: true, default_crew_size: 2,
    minutes_rule: rule, seasonal: "all", sort_order: 0, ...over,
  };
}

function seed(leadOver: Record<string, unknown> = {}, settingsOver = {}) {
  const customer = customerRow({ id: "c0000000-0000-4000-8000-000000000001", name: "Pat Smith", email: "pat@example.test", address: "1 Lake Rd" });
  const lead = {
    id: "10000000-0000-4000-8000-000000000001", created_at: T0, updated_at: T0, customer_id: customer.id, source: "web", utm: {},
    requested_service_ids: ["svc-leaf", "svc-edge"], custom_request: "Take down a dead maple", photo_paths: ["lead/1.jpg"],
    preferred_days: [1, 3], status: "new", ...leadOver,
  };
  return fleetDb({
    settings: [settingsRow({ min_job_price: 50, ...settingsOver })],
    customers: [customer],
    leads: [lead as never],
    services: [service("svc-leaf", "Leaf cleanup"), service("svc-edge", "Edging", { default_crew_size: 1 }), service("svc-old", "Old", { active: false })],
  });
}

describe("quote task", () => {
  beforeEach(() => vi.clearAllMocks());

  it("geocodes, prices standard items, flags the custom item and raises approvals", async () => {
    const db = seed();
    const ctx = makeCtx(db);
    const res = await runQuote(ctx, { lead_id: "10000000-0000-4000-8000-000000000001" });

    expect(geocode).toHaveBeenCalledWith("1 Lake Rd");
    expect(lookupParcel).toHaveBeenCalledWith({ lat: 41.48, lng: -81.84, address: "1 Lake Rd" });
    const customer = db.tables.customers[0];
    expect(customer).toMatchObject({ lat: 41.48, lng: -81.84, lot_acres: 0.5, parcel_id: "301-01-001" });

    const settings = settingsRow({ min_job_price: 50 });
    const hours = estimateHours(rule, 0.5, null); // (30 + 60*0.5) min = 1 h
    const leaf = priceItem({ crew_size: 2, est_hours: hours }, settings).price;
    const edge = priceItem({ crew_size: 1, est_hours: hours }, settings).price;

    expect(db.tables.quotes).toHaveLength(1);
    const quote = db.tables.quotes[0];
    const items = db.tables.quote_items.sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
    expect(items.map((i) => [i.description, i.status, i.price, i.is_custom])).toEqual([
      ["Leaf cleanup", "auto", leaf, false],
      ["Edging", "auto", edge, false],
      ["Take down a dead maple", "needs_owner", null, true],
    ]);
    const totals = priceQuote([{ crew_size: 2, est_hours: hours }, { crew_size: 1, est_hours: hours }], settings);
    expect(quote).toMatchObject({ status: "needs_owner", price_total: totals.price_total, labor_total: totals.labor_total, wage: 15, margin: 0.5 });
    expect(String(quote.rationale)).toMatch(/Leaf cleanup: 2 crew × 1 h × \$15/);

    expect(db.tables.fleet_tasks.map((t) => [t.type, t.dedupe_key])).toEqual([["custom_summary", "custom_summary:10000000-0000-4000-8000-000000000001"]]);
    const kinds = db.tables.approvals.map((a) => [a.kind, a.status, a.title]);
    expect(kinds).toContainEqual(["custom_item", "pending", "Custom request: Pat Smith"]);
    expect(kinds).toContainEqual(["quote", "pending", `Quote for Pat Smith — $${totals.price_total}`]);
    const qa = db.tables.approvals.find((a) => a.kind === "quote")!;
    expect(qa.payload).toMatchObject({ quote_id: quote.id, price_total: totals.price_total, needs_owner: true });
    expect((qa.payload as { items: unknown[] }).items).toHaveLength(3);
    expect(db.tables.leads[0].status).toBe("quoted");
    expect(res).toMatchObject({ status: "needs_owner", custom_items: 1, auto_sent: false });
  });

  it("is idempotent: a re-run updates the same quote and keeps the owner's work", async () => {
    const db = seed();
    const ctx = makeCtx(db);
    await runQuote(ctx, { lead_id: "10000000-0000-4000-8000-000000000001" });
    const custom = db.tables.quote_items.find((i) => i.is_custom)!;
    Object.assign(custom, { status: "priced", price: 700 });
    db.tables.leads[0].requested_service_ids = ["svc-leaf"];

    await runQuote(ctx, { lead_id: "10000000-0000-4000-8000-000000000001" });
    expect(db.tables.quotes).toHaveLength(1);
    expect(db.tables.quote_items.map((i) => [i.description, i.status, i.price])).toEqual(
      expect.arrayContaining([["Leaf cleanup", "auto", expect.any(Number)], ["Take down a dead maple", "priced", 700]]),
    );
    expect(db.tables.quote_items).toHaveLength(2); // edging dropped, custom kept
    expect(db.tables.quotes[0].status).toBe("draft");
    expect(db.tables.approvals.filter((a) => a.kind === "quote")).toHaveLength(1);
    expect(db.tables.fleet_tasks).toHaveLength(1);
  });

  it("leaves a sent quote alone", async () => {
    const db = seed();
    await runQuote(makeCtx(db), { lead_id: "10000000-0000-4000-8000-000000000001" });
    db.tables.quotes[0].status = "sent";
    const res = await runQuote(makeCtx(db), { lead_id: "10000000-0000-4000-8000-000000000001" });
    expect(res.skipped).toBe("quote already sent");
  });

  it("standard-only quote is a draft; autopilot sends it through the quote handler", async () => {
    const send = vi.fn();
    registerApprovalHandler("quote", send);
    const db = seed({ custom_request: null, photo_paths: [] }, {
      autopilot: { ...settingsRow().autopilot, quote: { enabled: true, max_total: 500 } },
    });
    const res = await runQuote(makeCtx(db), { lead_id: "10000000-0000-4000-8000-000000000001" });
    expect(db.tables.quote_items.some((i) => i.is_custom)).toBe(false);
    expect(db.tables.fleet_tasks ?? []).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.tables.approvals[0]).toMatchObject({ kind: "quote", status: "approved", decided_by: "autopilot" });
    expect(res.auto_sent).toBe(true);
  });

  it("a failed autopilot send goes back to the inbox instead of failing the task", async () => {
    registerApprovalHandler("quote", () => {
      throw new Error("STRIPE_SECRET_KEY is not set");
    });
    const db = seed({ custom_request: null, photo_paths: [] }, {
      autopilot: { ...settingsRow().autopilot, quote: { enabled: true, max_total: null } },
    });
    const res = await runQuote(makeCtx(db), { lead_id: "10000000-0000-4000-8000-000000000001" });
    expect(res.auto_sent).toBe(false);
    expect(db.tables.approvals[0]).toMatchObject({ status: "pending", decided_by: null });
    expect(String(db.tables.approvals[0].decision_note)).toMatch(/autopilot send failed: STRIPE_SECRET_KEY/);
  });

  it("a requested service without auto_quote becomes an owner-priced line", async () => {
    const db = seed({ custom_request: null, photo_paths: [], requested_service_ids: ["svc-leaf", "svc-gutter"] });
    db.tables.services.push(service("svc-gutter", "Gutter cleaning", { auto_quote: false }) as never);
    await runQuote(makeCtx(db), { lead_id: "10000000-0000-4000-8000-000000000001" });
    const gutter = db.tables.quote_items.find((i) => i.description === "Gutter cleaning")!;
    expect(gutter).toMatchObject({ status: "needs_owner", price: null, is_custom: false });
    expect(db.tables.quotes[0].status).toBe("needs_owner");
    expect(db.tables.approvals.find((a) => a.kind === "custom_item")!.title).toBe("Price needed: Gutter cleaning for Pat Smith");
  });

  it("a missing lead is a permanent failure", async () => {
    await expect(runQuote(makeCtx(seed()), { lead_id: "10000000-0000-4000-8000-0000000000ff" })).rejects.toThrow(/not found/);
  });
});
