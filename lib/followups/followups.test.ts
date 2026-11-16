import { describe, expect, it } from "vitest";
import { planFollowUp, sortFollowUps, type FollowUpInput } from "./plan";
import { suggestSales } from "./sell";

const today = "2026-11-16";
const base = (over: Partial<FollowUpInput> = {}): FollowUpInput => ({
  today,
  businessName: "Emmett's Property Services",
  customer: { id: "c1", name: "Jamie Smith", phone: "4405550123", email: null, createdOn: "2026-06-01" },
  onMowing: false,
  onSnow: false,
  jobs: [],
  lastCutOn: null,
  lastPushOn: null,
  quotes: [],
  leads: [],
  interactions: [],
  purchases: [],
  ...over,
});
const talk = (over: Partial<FollowUpInput["interactions"][number]>) => ({
  talkedOn: "2026-11-10", createdAt: "2026-11-10T15:00:00Z", category: "Leaves", price: null, followUpOn: null, status: "open", ...over,
});
const quote = (over: Partial<FollowUpInput["quotes"][number]>) => ({
  id: "q1", status: "sent", sentOn: "2026-11-10", createdOn: "2026-11-10", total: 240, services: ["Leaf Removal"], hasJob: false, ...over,
});

describe("planFollowUp", () => {
  it("leaves a customer alone while a job is on the calendar or waiting to be placed", () => {
    expect(planFollowUp(base({ jobs: [{ status: "booked", on: "2026-11-20", services: [] }] }))).toBeNull();
    expect(planFollowUp(base({ jobs: [{ status: "unscheduled", on: null, services: [] }] }))).toBeNull();
  });

  it("skips spam", () => {
    expect(planFollowUp(base({ leads: [{ id: "l1", status: "spam", createdOn: "2026-11-01", hasQuote: false }] }))).toBeNull();
  });

  it("flags a request with no price as due the day it came in", () => {
    const f = planFollowUp(base({ leads: [{ id: "l1", status: "new", createdOn: "2026-11-14", hasQuote: false }] }));
    expect(f).toMatchObject({ kind: "needs_quote", dueOn: "2026-11-14", overdue: 2, link: { href: "/admin/leads/l1" } });
    expect(f?.reason).toContain("2 days ago");
  });

  it("nudges an unanswered quote after 2 days, then 4 days after each nudge", () => {
    const first = planFollowUp(base({ quotes: [quote({})] }));
    expect(first).toMatchObject({ kind: "quote_waiting", dueOn: "2026-11-12", overdue: 4 });
    expect(first?.message).toContain("$240");
    const nudged = planFollowUp(base({ quotes: [quote({})], interactions: [talk({ talkedOn: "2026-11-14" })] }));
    expect(nudged).toMatchObject({ kind: "quote_waiting", dueOn: "2026-11-18", overdue: -2 });
  });

  it("stops chasing a quote once its job exists", () => {
    const f = planFollowUp(base({ quotes: [quote({ status: "accepted", hasJob: true })], jobs: [{ status: "done", on: "2026-10-20", services: ["Leaf Removal"] }] }));
    expect(f?.kind).toBe("past_customer");
  });

  it("uses the follow-up date the owner picked", () => {
    const f = planFollowUp(base({ interactions: [talk({ price: 180, followUpOn: "2026-11-16" })] }));
    expect(f).toMatchObject({ kind: "price_given", dueOn: today, overdue: 0 });
    expect(f?.message).toContain("$180");
  });

  it("follows a price given in conversation after 3 days", () => {
    expect(planFollowUp(base({ interactions: [talk({ price: 90 })] }))).toMatchObject({ kind: "price_given", dueOn: "2026-11-13" });
  });

  it("messages a past customer 21 days after the job, then every 30 days", () => {
    const jobs = [{ status: "done", on: "2026-10-20", services: ["Leaf Removal"] }];
    const f = planFollowUp(base({ jobs }));
    expect(f).toMatchObject({ kind: "past_customer", dueOn: "2026-11-10", lastJob: { on: "2026-10-20", what: "Leaf Removal" } });
    expect(f?.message).toContain("Thanks again");
    expect(f?.sell.length).toBeGreaterThan(0);
    expect(planFollowUp(base({ jobs, interactions: [talk({ talkedOn: "2026-11-10" })] }))?.dueOn).toBe("2026-12-10");
  });

  it("counts mowing cuts and snow pushes as the last job", () => {
    expect(planFollowUp(base({ onMowing: true, lastCutOn: "2026-10-30" }))).toMatchObject({ kind: "past_customer", dueOn: "2026-11-20", lastJob: { what: "mowing" } });
  });

  it("ignores a conversation older than the last job", () => {
    const f = planFollowUp(base({ jobs: [{ status: "done", on: "2026-10-20", services: [] }], interactions: [talk({ talkedOn: "2026-09-01", price: 50, followUpOn: "2026-09-05" })] }));
    expect(f).toMatchObject({ kind: "past_customer", dueOn: "2026-11-10" });
  });

  it("rests a customer who said no for 90 days", () => {
    expect(planFollowUp(base({ interactions: [talk({ status: "passed" })] }))).toMatchObject({ kind: "never_booked", dueOn: "2027-02-08" });
  });

  it("keeps someone who never booked on the list", () => {
    expect(planFollowUp(base())).toMatchObject({ kind: "never_booked", dueOn: "2026-06-08" });
    const expired = planFollowUp(base({ quotes: [quote({ status: "expired", sentOn: "2026-10-01", createdOn: "2026-10-01" })] }));
    expect(expired).toMatchObject({ kind: "never_booked", dueOn: "2026-10-08" });
    expect(expired?.reason).toContain("expired");
  });

  it("greets by first name, or 'there' when there isn't one", () => {
    expect(planFollowUp(base())?.message.startsWith("Hi Jamie, it's Emmett's Property Services.")).toBe(true);
    expect(planFollowUp(base({ customer: { ...base().customer, name: "Customer" } }))?.message.startsWith("Hi there,")).toBe(true);
  });

  it("sorts hot leads first, then longest overdue", () => {
    const rows = sortFollowUps([
      { kind: "past_customer" as const, overdue: 40 },
      { kind: "quote_waiting" as const, overdue: 1 },
      { kind: "quote_waiting" as const, overdue: 5 },
      { kind: "needs_quote" as const, overdue: 0 },
    ]);
    expect(rows.map((r) => `${r.kind}:${r.overdue}`)).toEqual(["needs_quote:0", "quote_waiting:5", "quote_waiting:1", "past_customer:40"]);
  });
});

describe("suggestSales", () => {
  const args = { today, onMowing: false, onSnow: false, purchases: [] };

  it("offers what's in season", () => {
    expect(suggestSales(args).map((s) => s.slug)).toEqual(["leaf-removal", "gutter-cleaning"]);
    expect(suggestSales({ ...args, today: "2026-05-10" }).map((s) => s.slug)).toEqual(["lawn-mowing", "mulching"]);
  });

  it("drops what they already have or just bought", () => {
    expect(suggestSales({ ...args, today: "2026-05-10", onMowing: true }).map((s) => s.slug)).toEqual(["mulching", "bush-trimming"]);
    expect(suggestSales({ ...args, today: "2026-12-10", onSnow: true }).map((s) => s.slug)).toEqual(["gutter-cleaning"]);
    expect(suggestSales({ ...args, purchases: [{ slug: "leaf-removal", on: "2026-11-01" }] }).map((s) => s.slug)).toEqual(["gutter-cleaning", "snow-removal"]);
  });

  it("puts last year's repeat on top", () => {
    const ideas = suggestSales({ ...args, purchases: [{ slug: "snow-removal", on: "2025-12-05" }] });
    expect(ideas[0]).toMatchObject({ slug: "snow-removal" });
    expect(ideas[0].why).toContain("last December");
  });

  it("only offers active services and uses their names", () => {
    const ideas = suggestSales({ ...args, catalogue: new Map([["gutter-cleaning", "Gutters"]]) });
    expect(ideas).toEqual([{ slug: "gutter-cleaning", name: "Gutters", why: expect.any(String) }]);
  });
});
