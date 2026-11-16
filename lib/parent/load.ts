import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { addDays, dateRange, zonedToUtc } from "@/lib/scheduler/time";
import { PARENT_JOB_STATUSES, buildParentWeek, type ParentDay, type ParentJobInput } from "./schedule";

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`parent view (${what}): ${res.error.message}`);
  return (res.data ?? []) as T;
}

/**
 * Load one Mon–Sun week for the parent view. Selects only the columns the page shows (plus quote
 * item status/price, used to keep declined lines out — the price itself is never returned).
 */
export async function loadParentWeek(db: AdminClient, monday: string): Promise<ParentDay[]> {
  const days = dateRange(monday, addDays(monday, 6));
  const from = zonedToUtc(monday, "00:00").toISOString();
  const to = zonedToUtc(addDays(monday, 7), "00:00").toISOString();

  const [jobs, mowRoutes, snowRoutes] = await Promise.all([
    db
      .from("jobs")
      .select("customer_id,quote_id,start_at,end_at,est_minutes,status,weather_hold")
      .in("status", PARENT_JOB_STATUSES)
      .gte("start_at", from)
      .lt("start_at", to)
      .then((r) => check(r, "jobs")),
    db.from("mow_routes").select("start_at,finish_at,stops").gte("run_date", monday).lte("run_date", days[6]).then((r) => check(r, "mow routes")),
    db.from("snow_routes").select("start_at,finish_at,stops").gte("run_date", monday).lte("run_date", days[6]).then((r) => check(r, "snow routes")),
  ]);

  const customerIds = Array.from(new Set(jobs.map((j) => j.customer_id)));
  const quoteIds = Array.from(new Set(jobs.map((j) => j.quote_id).filter((q): q is string => !!q)));
  const [customers, items] = await Promise.all([
    customerIds.length ? db.from("customers").select("id,address").in("id", customerIds).then((r) => check(r, "customers")) : [],
    quoteIds.length
      ? db
          .from("quote_items")
          .select("quote_id,description,price,sort_order")
          .in("quote_id", quoteIds)
          .in("status", ["auto", "priced"])
          .order("sort_order", { ascending: true })
          .then((r) => check(r, "quote items"))
      : [],
  ]);

  const address = new Map(customers.map((c) => [c.id, c.address]));
  const services = new Map<string, string[]>();
  for (const i of items) {
    if (i.price === null || i.price === undefined) continue; // unpriced custom line: not part of the job
    services.set(i.quote_id, [...(services.get(i.quote_id) ?? []), i.description]);
  }

  const jobInputs: ParentJobInput[] = jobs
    .filter((j) => j.start_at)
    .map((j) => ({
      start_at: j.start_at as string,
      end_at: j.end_at,
      est_minutes: j.est_minutes,
      status: j.status,
      weather_hold: j.weather_hold,
      address: address.get(j.customer_id) ?? null,
      services: j.quote_id ? services.get(j.quote_id) ?? [] : [],
    }));

  return buildParentWeek(days, { jobs: jobInputs, mowRoutes, snowRoutes });
}
