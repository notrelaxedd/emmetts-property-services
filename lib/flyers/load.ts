import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { allPages } from "./paged";
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
  const batchQ = () => {
    const q = db.from("flyer_batches").select("flyer_worker_id,flyer_count,amount,paid_at");
    return workerId ? q.eq("flyer_worker_id", workerId) : q;
  };
  const scanQ = () => {
    const q = db.from("flyer_scans").select("flyer_worker_id,visitor");
    return workerId ? q.eq("flyer_worker_id", workerId) : q;
  };
  const leadQ = () => {
    const q = db.from("leads").select("id,flyer_worker_id,status,created_at,customer_id").not("flyer_worker_id", "is", null);
    return workerId ? q.eq("flyer_worker_id", workerId) : q;
  };
  const [batches, scans, leadRows] = await Promise.all([
    allPages((a, b) => batchQ().order("id").range(a, b), "flyer batches"),
    allPages((a, b) => scanQ().order("id").range(a, b), "flyer scans"),
    allPages((a, b) => leadQ().order("created_at", { ascending: false }).order("id").range(a, b), "flyer leads"),
  ]);
  const leads = leadRows.filter((l): l is typeof l & { flyer_worker_id: string } => l.flyer_worker_id !== null);

  const quotes = await inChunks(
    leads.map((l) => l.id),
    (ids) => allPages((a, b) => db.from("quotes").select("id,lead_id").in("lead_id", ids).order("id").range(a, b), "flyer quotes"),
  );
  const leadByQuote = new Map(quotes.map((q) => [q.id, q.lead_id]));
  const jobs = await inChunks(
    Array.from(leadByQuote.keys()),
    (ids) =>
      allPages(
        (a, b) => db.from("jobs").select("id,quote_id").in("quote_id", ids).neq("status", "cancelled").order("id").range(a, b),
        "flyer jobs",
      ),
  );
  const bookedLeadIds = new Set<string>();
  for (const j of jobs) {
    const leadId = j.quote_id ? leadByQuote.get(j.quote_id) : undefined;
    if (leadId) bookedLeadIds.add(leadId);
  }

  const funnels = flyerFunnels({
    batches: batches.map((b) => ({ ...b, flyer_count: Number(b.flyer_count), amount: Number(b.amount) })),
    scans,
    leads,
    bookedLeadIds,
  });
  return { funnels, leads: leads.map((l) => ({ ...l, booked: bookedLeadIds.has(l.id) })) };
}
