/**
 * Sales rep commission: one row per lead a rep booked on /door, with the job it became, the commission
 * on it and whether it's been paid. Pure, so it's unit-testable; lib/commissions/load.ts feeds it.
 *
 * Status of a row:
 *   paid     a commission_payouts row exists for the job (amount locked at what was paid)
 *   owed     the job is done and not paid yet: pay the rep this much
 *   pending  booked / being quoted / scheduled, not done yet
 *   none     lost, spam, declined or cancelled: no commission
 */

export type CommissionStatus = "paid" | "owed" | "pending" | "none";

export const DEFAULT_COMMISSION_RATE = 0.2;

export type CommissionLeadIn = {
  leadId: string;
  repId: string;
  leadStatus: string;
  bookedAt: string;
  customerName: string;
  address: string | null;
};
export type CommissionJobIn = {
  jobId: string;
  leadId: string;
  status: string;
  price: number | null;
  services: string[];
  jobDate: string | null;
  completedAt: string | null;
  customerPaid: boolean;
};
export type CommissionPaidIn = {
  id: string;
  repId: string;
  jobId: string | null;
  amount: number;
  jobAmount: number;
  rate: number;
  paidAt: string;
  method: string;
  customerLabel: string;
};

export type CommissionRow = {
  key: string;
  repId: string;
  leadId: string | null;
  jobId: string | null;
  payoutId: string | null;
  bookedAt: string;
  jobDate: string | null;
  completedAt: string | null;
  customer: string;
  address: string | null;
  services: string[];
  /** Job price (the quote total). Null while it's still being priced. */
  price: number | null;
  /** What the rep gets (or got) for it. */
  commission: number;
  jobStatus: string;
  customerPaid: boolean;
  status: CommissionStatus;
  paidAt: string | null;
  method: string | null;
  /** Paid, but the job price has changed since. */
  priceChanged: boolean;
};

export type RepTotals = {
  leads: number;
  completed: number;
  sold: number;
  earned: number;
  paid: number;
  owed: number;
  pending: number;
};

export const cents = (n: number) => Math.round(n * 100) / 100;

/** rate × price, to the cent. */
export function commissionFor(price: number | null, rate: number): number {
  if (price === null || !Number.isFinite(price) || price <= 0) return 0;
  return cents(price * rate);
}

const DEAD_LEAD = new Set(["lost", "spam"]);

/**
 * The job that counts for a lead: the newest one that isn't cancelled, else the newest one.
 * (One lead normally has one job; a re-quote can leave a cancelled one behind.)
 */
function pickJob(jobs: CommissionJobIn[]): CommissionJobIn | null {
  if (!jobs.length) return null;
  return jobs.find((j) => j.status !== "cancelled") ?? jobs[0];
}

export function statusFor(job: CommissionJobIn | null, leadStatus: string, paid: boolean): CommissionStatus {
  if (paid) return "paid";
  if (!job) return DEAD_LEAD.has(leadStatus) ? "none" : "pending";
  if (job.status === "cancelled") return "none";
  if (job.status === "done") return job.price && job.price > 0 ? "owed" : "pending";
  return "pending";
}

/**
 * Rows for every rep lead, newest first. `rates` maps rep id → commission rate. Jobs must be
 * newest first per lead. Payouts whose job was deleted still show (as paid) so the history adds up.
 */
export function commissionRows(input: {
  leads: readonly CommissionLeadIn[];
  jobs: readonly CommissionJobIn[];
  payouts: readonly CommissionPaidIn[];
  rates: ReadonlyMap<string, number>;
}): CommissionRow[] {
  const jobsByLead = new Map<string, CommissionJobIn[]>();
  for (const j of input.jobs) {
    const list = jobsByLead.get(j.leadId) ?? [];
    list.push(j);
    jobsByLead.set(j.leadId, list);
  }
  const payoutByJob = new Map<string, CommissionPaidIn>();
  for (const p of input.payouts) if (p.jobId) payoutByJob.set(p.jobId, p);
  const used = new Set<string>();

  const rows: CommissionRow[] = input.leads.map((l) => {
    const job = pickJob(jobsByLead.get(l.leadId) ?? []);
    const payout = job ? payoutByJob.get(job.jobId) : undefined;
    if (payout) used.add(payout.id);
    const rate = input.rates.get(l.repId) ?? DEFAULT_COMMISSION_RATE;
    const price = job?.price ?? null;
    const status = statusFor(job, l.leadStatus, !!payout);
    return {
      key: l.leadId,
      repId: l.repId,
      leadId: l.leadId,
      jobId: job?.jobId ?? null,
      payoutId: payout?.id ?? null,
      bookedAt: l.bookedAt,
      jobDate: job?.jobDate ?? null,
      completedAt: job?.completedAt ?? null,
      customer: l.customerName,
      address: l.address,
      services: job?.services ?? [],
      price: payout ? payout.jobAmount : price,
      commission: payout ? cents(payout.amount) : status === "none" ? 0 : commissionFor(price, rate),
      jobStatus: job?.status ?? (DEAD_LEAD.has(l.leadStatus) ? l.leadStatus : "quoting"),
      customerPaid: job?.customerPaid ?? false,
      status,
      paidAt: payout?.paidAt ?? null,
      method: payout?.method ?? null,
      priceChanged: !!payout && price !== null && cents(price) !== cents(payout.jobAmount),
    };
  });

  // Paid for a job that has since been deleted (or whose lead moved): keep it on record.
  for (const p of input.payouts) {
    if (used.has(p.id)) continue;
    rows.push({
      key: `payout:${p.id}`,
      repId: p.repId,
      leadId: null,
      jobId: p.jobId,
      payoutId: p.id,
      bookedAt: p.paidAt,
      jobDate: null,
      completedAt: null,
      customer: p.customerLabel || "Deleted job",
      address: null,
      services: [],
      price: p.jobAmount,
      commission: cents(p.amount),
      jobStatus: "deleted",
      customerPaid: false,
      status: "paid",
      paidAt: p.paidAt,
      method: p.method,
      priceChanged: false,
    });
  }
  return rows.sort((a, b) => (a.bookedAt < b.bookedAt ? 1 : a.bookedAt > b.bookedAt ? -1 : 0));
}

export function emptyTotals(): RepTotals {
  return { leads: 0, completed: 0, sold: 0, earned: 0, paid: 0, owed: 0, pending: 0 };
}

/** Totals for a set of rows (one rep's, or everyone's). */
export function repTotals(rows: readonly CommissionRow[]): RepTotals {
  const t = emptyTotals();
  for (const r of rows) {
    if (r.leadId) t.leads++;
    if (r.status === "none") continue;
    if (r.jobStatus === "done" || (r.status === "paid" && r.jobStatus === "deleted")) t.completed++;
    if (r.status === "paid" || r.status === "owed") {
      t.sold += r.price ?? 0;
      t.earned += r.commission;
    }
    if (r.status === "paid") t.paid += r.commission;
    if (r.status === "owed") t.owed += r.commission;
    if (r.status === "pending") t.pending += r.commission;
  }
  return { ...t, sold: cents(t.sold), earned: cents(t.earned), paid: cents(t.paid), owed: cents(t.owed), pending: cents(t.pending) };
}

/** Rows grouped by rep id. */
export function rowsByRep(rows: readonly CommissionRow[]): Map<string, CommissionRow[]> {
  const out = new Map<string, CommissionRow[]>();
  for (const r of rows) {
    const list = out.get(r.repId) ?? [];
    list.push(r);
    out.set(r.repId, list);
  }
  return out;
}

/** 0.2 → "20%". */
export function ratePercent(rate: number): string {
  const p = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(p) ? p.toFixed(0) : p.toFixed(1)}%`;
}
