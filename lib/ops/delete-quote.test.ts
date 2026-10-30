import { describe, expect, it } from "vitest";
import { deleteJob, deleteQuote } from "./delete-quote";
import { fakeDb } from "./test-utils";

const world = () =>
  fakeDb({
    leads: [{ id: "l1", customer_id: "c1", source: "web" }, { id: "l2", customer_id: "c1", source: "web" }] as never,
    quotes: [
      { id: "q1", lead_id: "l1", customer_id: "c1", paid_at: "2026-10-20T16:00:00Z", stripe_checkout_id: null, stripe_invoice_id: null },
      { id: "q2", lead_id: "l2", customer_id: "c1", paid_at: null, stripe_checkout_id: null, stripe_invoice_id: null },
    ] as never,
    quote_items: [{ id: "i1", quote_id: "q1" }, { id: "i2", quote_id: "q2" }] as never,
    jobs: [
      { id: "j1", quote_id: "q1", customer_id: "c1" },
      { id: "j2", quote_id: "q2", customer_id: "c1" },
      { id: "j3", quote_id: null, customer_id: "c1" },
    ] as never,
    approvals: [
      { id: "a1", ref_table: "quotes", ref_id: "q1" },
      { id: "a2", ref_table: "quote_items", ref_id: "i1" },
      { id: "a3", ref_table: "jobs", ref_id: "j1" },
      { id: "a4", ref_table: "quotes", ref_id: "q2" },
    ] as never,
  });

describe("deleteQuote", () => {
  it("deletes the quote, its lines, job, approvals and lead, and leaves the other quote alone", async () => {
    const db = world();
    await expect(deleteQuote(db, "q1")).resolves.toEqual({ customerId: "c1" });
    expect(db.tables.quotes.map((q) => q.id)).toEqual(["q2"]);
    expect(db.tables.quote_items.map((i) => i.id)).toEqual(["i2"]);
    expect(db.tables.jobs.map((j) => j.id)).toEqual(["j2", "j3"]);
    expect(db.tables.approvals.map((a) => a.id)).toEqual(["a4"]);
    expect(db.tables.leads.map((l) => l.id)).toEqual(["l2"]);
  });

  it("keeps the lead when another quote still uses it", async () => {
    const db = world();
    db.tables.quotes.push({ id: "q3", lead_id: "l1", customer_id: "c1", paid_at: null });
    await deleteQuote(db, "q1");
    expect(db.tables.leads.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("refuses a job with crew payouts, deleting nothing", async () => {
    const db = world();
    db.tables.payouts = [{ id: "p1", job_id: "j1" }];
    await expect(deleteQuote(db, "q1")).rejects.toThrow(/crew payouts/);
    expect(db.tables.quotes).toHaveLength(2);
    expect(db.tables.jobs).toHaveLength(3);
    expect(db.tables.approvals).toHaveLength(4);
  });

  it("says when the quote is gone", async () => {
    await expect(deleteQuote(world(), "nope")).rejects.toThrow(/not found/);
  });
});

describe("deleteJob", () => {
  it("takes the job's quote with it, so its revenue comes off too", async () => {
    const db = world();
    await deleteJob(db, "j1");
    expect(db.tables.quotes.map((q) => q.id)).toEqual(["q2"]);
    expect(db.tables.jobs.map((j) => j.id)).toEqual(["j2", "j3"]);
  });

  it("deletes a job with no quote on its own", async () => {
    const db = world();
    await expect(deleteJob(db, "j3")).resolves.toEqual({ customerId: "c1" });
    expect(db.tables.jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
    expect(db.tables.quotes).toHaveLength(2);
  });
});
