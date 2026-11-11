import "server-only";
import { check } from "@/lib/ops/types";
import type { AdminClient } from "@/lib/supabase/admin";
import type { SalesRep } from "@/lib/db/types";
import { commissionRows, type CommissionJobIn, type CommissionLeadIn, type CommissionPaidIn, type CommissionRow } from "./stats";

/** Ids per `.in()` filter, keeping PostgREST URLs short. */
const CHUNK = 100;

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetch(ids.slice(i, i + CHUNK))));
  return out;
}

/**
 * Every rep (removed ones too) and a commission row for every lead they booked, or just one rep's.
 * Lead → its quotes → their jobs; the job's price is its quote's total.
 */
export async function loadCommissions(
  db: AdminClient,
  repId?: string,
): Promise<{ reps: SalesRep[]; rows: CommissionRow[] }> {
  let repQ = db.from("sales_reps").select("*").order("name");
  let leadQ = db.from("leads").select("id,sales_rep_id,status,created_at,customer_id").not("sales_rep_id", "is", null);
  let payQ = db.from("commission_payouts").select("*");
  if (repId) {
    repQ = repQ.eq("id", repId);
    leadQ = leadQ.eq("sales_rep_id", repId);
    payQ = payQ.eq("sales_rep_id", repId);
  }
  const [repRes, leadRes, payRes] = await Promise.all([repQ, leadQ.order("created_at", { ascending: false }), payQ]);
  const reps = check(repRes, "sales reps") ?? [];
  const leads = (check(leadRes, "rep leads") ?? []).filter(
    (l): l is typeof l & { sales_rep_id: string } => l.sales_rep_id !== null,
  );
  const payouts = check(payRes, "commission payouts") ?? [];

  const customerIds = Array.from(new Set(leads.map((l) => l.customer_id)));
  const leadIds = leads.map((l) => l.id);
  const [customers, quotes] = await Promise.all([
    inChunks(customerIds, async (ids) => check(await db.from("customers").select("id,name,address").in("id", ids), "rep customers") ?? []),
    inChunks(leadIds, async (ids) => check(await db.from("quotes").select("id,lead_id,price_total,paid_at").in("lead_id", ids), "rep quotes") ?? []),
  ]);
  const quoteIds = quotes.map((q) => q.id);
  const [jobs, items] = await Promise.all([
    inChunks(quoteIds, async (ids) =>
      check(
        await db.from("jobs").select("id,quote_id,status,start_at,completed_at,paid,created_at").in("quote_id", ids).order("created_at", { ascending: false }),
        "rep jobs",
      ) ?? [],
    ),
    inChunks(quoteIds, async (ids) =>
      check(await db.from("quote_items").select("quote_id,description,status").in("quote_id", ids).order("created_at"), "rep quote items") ?? [],
    ),
  ]);

  const custById = new Map(customers.map((c) => [c.id, c]));
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const servicesByQuote = new Map<string, string[]>();
  for (const it of items) {
    if (it.status === "declined" || it.status === "referred") continue;
    const list = servicesByQuote.get(it.quote_id) ?? [];
    list.push(it.description);
    servicesByQuote.set(it.quote_id, list);
  }

  const leadIn: CommissionLeadIn[] = leads.map((l) => {
    const c = custById.get(l.customer_id);
    return { leadId: l.id, repId: l.sales_rep_id, leadStatus: l.status, bookedAt: l.created_at, customerName: c?.name ?? "Customer", address: c?.address ?? null };
  });
  const jobIn: CommissionJobIn[] = [];
  for (const j of jobs) {
    const q = j.quote_id ? quoteById.get(j.quote_id) : undefined;
    if (!q) continue;
    jobIn.push({
      jobId: j.id,
      leadId: q.lead_id,
      status: j.status,
      price: q.price_total === null ? null : Number(q.price_total),
      services: servicesByQuote.get(q.id) ?? [],
      jobDate: j.start_at,
      completedAt: j.completed_at,
      customerPaid: j.paid || q.paid_at !== null,
    });
  }
  const paidIn: CommissionPaidIn[] = payouts.map((p) => ({
    id: p.id,
    repId: p.sales_rep_id,
    jobId: p.job_id,
    amount: Number(p.amount),
    jobAmount: Number(p.job_amount),
    rate: Number(p.rate),
    paidAt: p.paid_at,
    method: p.method,
    customerLabel: p.customer_label,
  }));

  const rates = new Map(reps.map((r) => [r.id, Number(r.commission_rate)]));
  return { reps, rows: commissionRows({ leads: leadIn, jobs: jobIn, payouts: paidIn, rates }) };
}
