import "server-only"

import { AUTOPILOT_KINDS } from "@/components/admin/autopilot/kinds"
import type { CrewAvailability, CrewException } from "@/lib/db/types"
import { getSettings } from "@/lib/ops/settings"
import { localDate, weekStart, zonedToUtc } from "@/lib/scheduler/time"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { OPEN_LEAD_STATUSES } from "./leads-body"
import { OPEN_QUOTE_STATUSES } from "./quotes-body"
import type { StageKey } from "./stages"
import { freeOn, upcomingWeekend } from "./weekend"

/** Online = a heartbeat in the last 2 minutes (same rule as `app/admin/layout.tsx`). */
const ONLINE_WINDOW_MS = 2 * 60 * 1000

export type StageCount = {
  /** The one big number, already formatted. */
  value: string
  /** The short line under it. */
  line: string
  /** Something here needs the owner. */
  attention: boolean
  /** Customers sitting in this stage (Leads, Quotes, Schedule, Money only). */
  people?: { names: string[]; total: number }
}

export type FrontPageData = { counts: Record<StageKey, StageCount>; pendingApprovals: number }

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const usd = (n: number) => usd0.format(Number.isFinite(n) ? n : 0)

type Res<T> = { data: T | null; error: unknown } | null
const rows = <T,>(r: Res<T[]>): T[] => (r && !r.error ? (r.data ?? []) : [])
const countOf = (r: { count: number | null; error: unknown } | null): number => (r && !r.error ? (r.count ?? 0) : 0)

/** Never throws: a failed query (missing env, table or column) counts as nothing. */
async function guard<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}

/** Distinct customer ids in first-seen order. */
function distinct(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

/**
 * Everything the front page's boxes show, from one round of queries. Every query is guarded like the
 * console layout's: missing env or tables render 0, never an error page.
 */
export async function loadFrontPage(now: Date = new Date()): Promise<FrontPageData> {
  const db = getSupabaseAdmin()
  const monday = weekStart(localDate(now))
  const weekFrom = zonedToUtc(monday, "00:00").toISOString()
  const { sat, sun } = upcomingWeekend(now)

  const [
    ads,
    leads,
    customers,
    quotes,
    jobs,
    paidThisWeek,
    unpaidAccepted,
    doneUnpaidJobs,
    crew,
    crewBlocks,
    weekendExceptions,
    pendingRequests,
    workers,
    settings,
    pendingApprovals,
  ] = db
    ? await Promise.all([
        guard(db.from("ads").select("status")),
        guard(db.from("leads").select("customer_id,status,created_at").in("status", OPEN_LEAD_STATUSES).order("created_at", { ascending: false })),
        guard(db.from("customers").select("id", { count: "exact", head: true })),
        guard(
          db.from("quotes").select("customer_id,status,price_total,created_at").in("status", OPEN_QUOTE_STATUSES).order("created_at", { ascending: false }),
        ),
        guard(db.from("jobs").select("customer_id,status,start_at").not("status", "in", "(done,cancelled)").order("start_at", { ascending: true, nullsFirst: true })),
        guard(db.from("quotes").select("price_total").gte("paid_at", weekFrom)),
        guard(db.from("quotes").select("id,customer_id,price_total").eq("status", "accepted").is("paid_at", null)),
        guard(db.from("jobs").select("quote_id,customer_id,completed_at").eq("status", "done").eq("paid", false).order("completed_at", { ascending: false })),
        guard(db.from("profiles").select("id").eq("role", "crew").is("removed_at", null).eq("paused", false)),
        guard(db.from("crew_availability").select("*")),
        guard(db.from("crew_exceptions").select("*").eq("status", "approved").lte("date_from", sun).gte("date_to", sat)),
        guard(db.from("crew_exceptions").select("id", { count: "exact", head: true }).eq("status", "pending")),
        guard(db.from("fleet_workers").select("last_heartbeat")),
        guard(getSettings(db)),
        guard(db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending")),
      ])
    : Array.from({ length: 15 }, () => null)

  type R<T> = Res<T[]>
  const adRows = rows(ads as R<{ status: string }>)
  const leadRows = rows(leads as R<{ customer_id: string; status: string }>)
  const quoteRows = rows(quotes as R<{ customer_id: string; status: string; price_total: number }>)
  const jobRows = rows(jobs as R<{ customer_id: string; status: string }>)
  const paidRows = rows(paidThisWeek as R<{ price_total: number }>)
  const acceptedRows = rows(unpaidAccepted as R<{ id: string; customer_id: string; price_total: number }>)
  const doneRows = rows(doneUnpaidJobs as R<{ quote_id: string | null; customer_id: string }>)
  const crewRows = rows(crew as R<{ id: string }>)
  const blockRows = rows(crewBlocks as R<CrewAvailability>)
  const exceptionRows = rows(weekendExceptions as R<CrewException>)
  const workerRows = rows(workers as R<{ last_heartbeat: string | null }>)

  // Money: a done job whose quote the customer confirmed and hasn't paid yet.
  const acceptedById = new Map(acceptedRows.map((q) => [q.id, q]))
  const toCollect = doneRows
    .map((j) => (j.quote_id ? acceptedById.get(j.quote_id) : undefined))
    .filter((q): q is { id: string; customer_id: string; price_total: number } => !!q)
  const toCollectUnique = Array.from(new Map(toCollect.map((q) => [q.id, q])).values())

  const peopleIds = {
    leads: distinct(leadRows.map((l) => l.customer_id)),
    quotes: distinct(quoteRows.map((q) => q.customer_id)),
    schedule: distinct(jobRows.map((j) => j.customer_id)),
    money: distinct(toCollectUnique.map((q) => q.customer_id)),
  }
  const shownIds = distinct(Object.values(peopleIds).flatMap((ids) => ids.slice(0, 4)))
  const names = new Map<string, string>()
  if (db && shownIds.length) {
    const res = await guard(db.from("customers").select("id,name").in("id", shownIds))
    for (const c of rows(res as R<{ id: string; name: string }>)) names.set(c.id, c.name)
  }
  const people = (ids: string[]) => ({ names: ids.slice(0, 4).map((id) => names.get(id) ?? "?"), total: ids.length })

  const draftAds = adRows.filter((a) => a.status === "draft").length
  const readyAds = adRows.filter((a) => a.status === "approved").length
  const needsYou = quoteRows.filter((q) => q.status === "needs_owner").length
  const quoteTotal = quoteRows.reduce((a, q) => a + (Number(q.price_total) || 0), 0)
  const toCall = jobRows.filter((j) => j.status === "proposed" || j.status === "crew_confirmed").length
  const freeSat = crewRows.filter((c) => freeOn(c.id, sat, blockRows, exceptionRows)).length
  const cutoff = now.getTime() - ONLINE_WINDOW_MS
  const online = workerRows.filter((w) => w.last_heartbeat && new Date(w.last_heartbeat).getTime() >= cutoff).length
  const autopilot = settings && typeof settings === "object" && "autopilot" in settings ? settings.autopilot : null
  const rulesOn = autopilot ? AUTOPILOT_KINDS.filter((k) => autopilot[k.kind]?.enabled).length : 0

  const counts: Record<StageKey, StageCount> = {
    ads: { value: String(readyAds), line: `ready to post · ${draftAds} draft`, attention: draftAds > 0 },
    leads: {
      value: String(leadRows.length),
      line: "waiting on a quote",
      attention: leadRows.some((l) => l.status === "new"),
      people: people(peopleIds.leads),
    },
    customers: { value: String(countOf(customers as { count: number | null; error: unknown } | null)), line: "in customer log", attention: false },
    quotes: {
      value: String(quoteRows.length),
      line: `${needsYou} need${needsYou === 1 ? "s" : ""} you · ${usd(quoteTotal)}`,
      attention: needsYou > 0,
      people: people(peopleIds.quotes),
    },
    schedule: {
      value: String(jobRows.length),
      line: toCall ? `${toCall} to call and confirm` : "all confirmed",
      attention: jobRows.some((j) => j.status === "unscheduled" || j.status === "proposed" || j.status === "crew_confirmed"),
      people: people(peopleIds.schedule),
    },
    money: {
      value: usd(paidRows.reduce((a, q) => a + (Number(q.price_total) || 0), 0)),
      line: `${usd(toCollectUnique.reduce((a, q) => a + (Number(q.price_total) || 0), 0))} still to collect`,
      attention: toCollectUnique.length > 0,
      people: people(peopleIds.money),
    },
    crew: {
      value: String(crewRows.length),
      line: `crew · ${freeSat} free Sat`,
      attention: countOf(pendingRequests as { count: number | null; error: unknown } | null) > 0,
    },
    fleet: { value: String(workerRows.length), line: `computers · ${online} running`, attention: online === 0 },
    autopilot: { value: `${rulesOn}/${AUTOPILOT_KINDS.length}`, line: "rules on", attention: false },
  }

  return { counts, pendingApprovals: countOf(pendingApprovals as { count: number | null; error: unknown } | null) }
}
