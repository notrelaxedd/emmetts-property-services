import { describe, expect, it } from "vitest";
import { commissionFor, commissionRows, ratePercent, repTotals, rowsByRep, statusFor, type CommissionJobIn } from "./stats";

const job = (over: Partial<CommissionJobIn> = {}): CommissionJobIn => ({
  jobId: "j1",
  leadId: "l1",
  status: "done",
  price: 50,
  services: ["Fall Cleanup"],
  jobDate: "2026-11-16T20:30:00Z",
  completedAt: "2026-11-16T22:00:00Z",
  customerPaid: false,
  ...over,
});
const lead = (leadId: string, repId = "r1", leadStatus = "won", bookedAt = "2026-11-10T15:00:00Z") => ({
  leadId,
  repId,
  leadStatus,
  bookedAt,
  customerName: `Customer ${leadId}`,
  address: "1 A St",
});

describe("commission math", () => {
  it("is rate × price to the cent", () => {
    expect(commissionFor(50, 0.2)).toBe(10);
    expect(commissionFor(133.33, 0.2)).toBe(26.67);
    expect(commissionFor(null, 0.2)).toBe(0);
    expect(commissionFor(0, 0.2)).toBe(0);
  });

  it("is owed as soon as the job is done, whether or not the customer paid", () => {
    expect(statusFor(job(), "won", false)).toBe("owed");
    expect(statusFor(job({ customerPaid: true }), "won", false)).toBe("owed");
    expect(statusFor(job({ status: "booked" }), "won", false)).toBe("pending");
    expect(statusFor(job({ status: "cancelled" }), "won", false)).toBe("none");
    expect(statusFor(null, "quoting", false)).toBe("pending");
    expect(statusFor(null, "lost", false)).toBe("none");
    expect(statusFor(job({ status: "booked" }), "won", true)).toBe("paid");
  });

  it("builds one row per lead, newest first, and totals them", () => {
    const rows = commissionRows({
      leads: [lead("l1", "r1", "won", "2026-11-10T15:00:00Z"), lead("l2", "r1", "won", "2026-11-11T15:00:00Z"), lead("l3", "r1", "lost"), lead("l4", "r2")],
      jobs: [
        job(),
        job({ jobId: "j2", leadId: "l2", status: "booked", price: 100 }),
        job({ jobId: "j4", leadId: "l4", price: 80 }),
      ],
      payouts: [],
      rates: new Map([
        ["r1", 0.2],
        ["r2", 0.25],
      ]),
    });
    expect(rows.map((r) => r.leadId)).toEqual(["l2", "l1", "l3", "l4"]);
    const r1 = rowsByRep(rows).get("r1")!;
    expect(repTotals(r1)).toEqual({ leads: 3, completed: 1, sold: 50, earned: 10, paid: 0, owed: 10, pending: 20 });
    expect(rowsByRep(rows).get("r2")![0].commission).toBe(20);
  });

  it("locks a paid amount even if the price or rate changes later", () => {
    const rows = commissionRows({
      leads: [lead("l1")],
      jobs: [job({ price: 60 })],
      payouts: [{ id: "p1", repId: "r1", jobId: "j1", amount: 10, jobAmount: 50, rate: 0.2, paidAt: "2026-11-17T00:00:00Z", method: "cash", customerLabel: "" }],
      rates: new Map([["r1", 0.3]]),
    });
    expect(rows[0]).toMatchObject({ status: "paid", commission: 10, price: 50, priceChanged: true, payoutId: "p1" });
    expect(repTotals(rows)).toMatchObject({ paid: 10, owed: 0, earned: 10 });
  });

  it("keeps a payout on record after its job is deleted", () => {
    const rows = commissionRows({
      leads: [],
      jobs: [],
      payouts: [{ id: "p1", repId: "r1", jobId: null, amount: 12, jobAmount: 60, rate: 0.2, paidAt: "2026-11-17T00:00:00Z", method: "cash", customerLabel: "Pat · 1 A St" }],
      rates: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "paid", customer: "Pat · 1 A St", commission: 12 });
    expect(repTotals(rows)).toMatchObject({ leads: 0, paid: 12 });
  });

  it("uses the live job over a cancelled one", () => {
    const rows = commissionRows({
      leads: [lead("l1")],
      jobs: [job({ jobId: "new", status: "booked" }), job({ jobId: "old", status: "cancelled" })],
      payouts: [],
      rates: new Map([["r1", 0.2]]),
    });
    expect(rows[0]).toMatchObject({ jobId: "new", status: "pending" });
  });

  it("formats the rate", () => {
    expect(ratePercent(0.2)).toBe("20%");
    expect(ratePercent(0.125)).toBe("12.5%");
  });
});
