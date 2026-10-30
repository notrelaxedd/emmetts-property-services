import { describe, expect, it } from "vitest";
import { localDate } from "../scheduler/time";
import { manualJobNote, recordManualJob, removeManualJob, type ManualJob } from "./manual-jobs";
import { customerRow, fakeDb, settingsRow } from "./test-utils";

const world = () =>
  fakeDb({
    customers: [customerRow({ id: "c1", name: "Jo Smith" })],
    settings: [settingsRow({ card_fee_pct: 0.029, card_fee_fixed: 0.3 })],
  });
const input = (over: Partial<ManualJob> = {}): ManualJob => ({
  customerId: "c1", description: "Fall cleanup", date: "2026-10-20", price: 250, paid: 250, method: "cash", labor: 60,
  recordedBy: "owner@example.com", ...over,
});

describe("recordManualJob", () => {
  it("writes a won lead, a paid accepted quote, one priced line and a done paid job, all on the job's day", async () => {
    const db = world();
    const { quoteId, jobId } = await recordManualJob(db, input());

    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.leads[0]).toMatchObject({ customer_id: "c1", source: "manual", status: "won", custom_request: "Fall cleanup" });
    const q = db.tables.quotes[0];
    expect(q).toMatchObject({
      id: quoteId, lead_id: db.tables.leads[0].id, customer_id: "c1", status: "accepted", price_total: 250, labor_total: 60,
      fee_total: 0, profit_total: 190, payment_method: "cash",
    });
    expect(localDate(new Date(q.paid_at as string))).toBe("2026-10-20");
    expect(q.accepted_at).toBe(q.paid_at);
    expect(db.tables.quote_items).toEqual([
      expect.objectContaining({ quote_id: quoteId, description: "Fall cleanup", price: 250, status: "priced", is_custom: true }),
    ]);
    expect(db.tables.jobs).toEqual([
      expect.objectContaining({ id: jobId, quote_id: quoteId, customer_id: "c1", status: "done", paid: true, paid_at: q.paid_at, completed_at: q.paid_at }),
    ]);
    // Nothing queued: no scheduling, no emails.
    expect(db.tables.fleet_tasks ?? []).toHaveLength(0);
  });

  it("counts a tip as revenue", async () => {
    const db = world();
    await recordManualJob(db, input({ price: 80, paid: 100, labor: 30 }));
    expect(db.tables.quotes[0]).toMatchObject({ price_total: 100, profit_total: 70 });
    expect(db.tables.quote_items[0].price).toBe(80);
  });

  it("counts what they paid as revenue and keeps the price on the line", async () => {
    const db = world();
    await recordManualJob(db, input({ price: 250, paid: 220, labor: 0 }));
    expect(db.tables.quotes[0]).toMatchObject({ price_total: 220, profit_total: 220 });
    expect(db.tables.quote_items[0].price).toBe(250);
    expect(db.tables.quotes[0].rationale).toBe(
      "Recorded by hand: done and paid by cash ($220.00); priced at $250.00, $30.00 less, by owner@example.com.",
    );
  });

  it("takes the card fee off a card payment", async () => {
    const db = world();
    await recordManualJob(db, input({ method: "stripe", paid: 100, price: 100, labor: 0 }));
    expect(db.tables.quotes[0]).toMatchObject({ payment_method: "stripe", fee_total: 3.2, profit_total: 96.8 });
  });

  it("refuses bad input and a missing customer without writing anything", async () => {
    const db = world();
    await expect(recordManualJob(db, input({ paid: 0 }))).rejects.toThrow(/more than \$0/);
    await expect(recordManualJob(db, input({ price: 0 }))).rejects.toThrow(/price/);
    await expect(recordManualJob(db, input({ description: "  " }))).rejects.toThrow(/what the job was/);
    await expect(recordManualJob(db, input({ customerId: "nope" }))).rejects.toThrow(/Customer not found/);
    expect(db.tables.leads ?? []).toHaveLength(0);
    expect(db.tables.quotes ?? []).toHaveLength(0);
  });
});

describe("manualJobNote", () => {
  it("calls anything paid over the price a tip", () => {
    expect(manualJobNote({ price: 80, paid: 100, method: "check", recordedBy: "o@x.com" })).toBe(
      "Recorded by hand: done and paid by check ($100.00); priced at $80.00, $20.00 tip, by o@x.com.",
    );
  });
});

describe("removeManualJob", () => {
  it("removes the job and its lead (which takes the quote with it)", async () => {
    const db = world();
    const { quoteId } = await recordManualJob(db, input());
    await expect(removeManualJob(db, quoteId)).resolves.toEqual({ customerId: "c1" });
    expect(db.tables.jobs).toHaveLength(0);
    expect(db.tables.leads).toHaveLength(0);
  });

  it("refuses a quote that came in through the site", async () => {
    const db = fakeDb({
      quotes: [{ id: "q1", lead_id: "l1", customer_id: "c1" }] as never,
      leads: [{ id: "l1", source: "web" }] as never,
      jobs: [{ id: "j1", quote_id: "q1" }] as never,
    });
    await expect(removeManualJob(db, "q1")).rejects.toThrow(/added by hand/);
    expect(db.tables.jobs).toHaveLength(1);
  });
});
