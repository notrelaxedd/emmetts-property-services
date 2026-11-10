import { describe, expect, it } from "vitest";
import { createOwnerJob, type OwnerJob } from "./owner-jobs";
import { customerRow, fakeDb, settingsRow } from "./test-utils";

const world = () =>
  fakeDb({
    customers: [customerRow({ id: "c1", name: "Jo Smith" })],
    settings: [settingsRow({ default_wage: 15, card_fee_pct: 0.029, card_fee_fixed: 0.3 })],
  });
const input = (over: Partial<OwnerJob> = {}): OwnerJob => ({
  customerId: "c1", description: "Fall cleanup", price: 120, hours: 2, crewSize: 2, paymentMethod: "cash",
  recordedBy: "owner@example.com", ...over,
});

describe("createOwnerJob", () => {
  it("writes a won lead, an accepted unpaid quote, one priced line and an unscheduled job sized from it", async () => {
    const db = world();
    const { quoteId, job } = await createOwnerJob(db, input());

    expect(db.tables.leads).toEqual([expect.objectContaining({ customer_id: "c1", source: "owner", status: "won", custom_request: "Fall cleanup" })]);
    expect(db.tables.quotes[0]).toMatchObject({
      id: quoteId, customer_id: "c1", status: "accepted", price_total: 120, labor_total: 60, fee_total: 0, profit_total: 60,
      payment_method: "cash", paid_at: null,
    });
    expect(db.tables.quote_items).toEqual([
      expect.objectContaining({ quote_id: quoteId, description: "Fall cleanup", price: 120, est_hours: 2, crew_size: 2, status: "priced" }),
    ]);
    expect(job).toMatchObject({ quote_id: quoteId, customer_id: "c1", status: "unscheduled", est_minutes: 120, crew_size: 2, paid: false });
  });

  it("takes the card fee off a card job", async () => {
    const db = world();
    await createOwnerJob(db, input({ paymentMethod: "stripe", price: 100, hours: 1, crewSize: 1 }));
    expect(db.tables.quotes[0]).toMatchObject({ fee_total: 3.2, labor_total: 15, profit_total: 81.8 });
  });

  it("refuses bad input and a missing customer without writing anything", async () => {
    const db = world();
    await expect(createOwnerJob(db, input({ description: " " }))).rejects.toThrow(/what the job is/);
    await expect(createOwnerJob(db, input({ hours: 0 }))).rejects.toThrow(/how long/);
    await expect(createOwnerJob(db, input({ customerId: "nope" }))).rejects.toThrow(/Customer not found/);
    expect(db.tables.leads ?? []).toHaveLength(0);
  });
});
