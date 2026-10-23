import "server-only";
import { check } from "@/lib/ops/types";
import type { AdminClient } from "@/lib/supabase/admin";
import { flyerFunnels, type FlyerFunnel } from "./stats";

/** Ids per `.in()` filter, keeping PostgREST URLs short. */
const CHUNK = 100;

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetch(ids.slice(i, i + CHUNK))));
  return out;
}

export type FlyerLead = { id: string; flyer_worker_id: string; status: string; created_at: string; customer_id: string; booked: boolean };

/**
 * Funnels (flyers out -> scans -> quote requests -> jobs booked, plus pay) for every flyer worker,
 * or just one. A lead counts as booked once any job from its quotes is not cancelled.
 */
export async function loadFlyerFunnels(
  db: AdminClient,
  workerId?: string,
): Promise<{ funnels: Map<string, FlyerFunnel>; leads: FlyerLead[] }> {
  let batchQ = db.from("flyer_batches").select("flyer_worker_id,flyer_count,amount,paid_at");
  let scanQ = db.from("flyer_scans").select("flyer_worker_id,visitor");
  let leadQ = db.from("leads").select("id,flyer_worker_id,status,created_at,customer_id").not("flyer_worker_id", "is", null);
  if (workerId) {
    batchQ = batchQ.eq("flyer_worker_id", workerId);
    scanQ = scanQ.eq("flyer_worker_id", workerId);
    leadQ = leadQ.eq("flyer_worker_id", workerId);
  }
  const [batches, scans, leadRows] = await Promise.all([batchQ, scanQ, leadQ.order("created_at", { ascending: false })]);
  check(batches, "flyer batches");
  check(scans, "flyer scans");
  const leads = (check(leadRows, "flyer leads") ?? []).filter(
    (l): l is typeof l & { flyer_worker_id: string } => l.flyer_worker_id !== null,
  );

  const quotes = await inChunks(
    leads.map((l) => l.id),
    async (ids) => check(await db.from("quotes").select("id,lead_id").in("lead_id", ids), "flyer quotes") ?? [],
  );
  const leadByQuote = new Map(quotes.map((q) => [q.id, q.lead_id]));
  const jobs = await inChunks(
    Array.from(leadByQuote.keys()),
    async (ids) =>
      check(await db.from("jobs").select("quote_id").in("quote_id", ids).neq("status", "cancelled"), "flyer jobs") ?? [],
  );
  const bookedLeadIds = new Set<string>();
  for (const j of jobs) {
    const leadId = j.quote_id ? leadByQuote.get(j.quote_id) : undefined;
    if (leadId) bookedLeadIds.add(leadId);
  }

  const funnels = flyerFunnels({
    batches: (batches.data ?? []).map((b) => ({ ...b, flyer_count: Number(b.flyer_count), amount: Number(b.amount) })),
    scans: scans.data ?? [],
    leads,
    bookedLeadIds,
  });
  return { funnels, leads: leads.map((l) => ({ ...l, booked: bookedLeadIds.has(l.id) })) };
}
