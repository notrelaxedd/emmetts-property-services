import "server-only"

import type { ScheduleCrew, ScheduleJob } from "@/components/admin/schedule/types"
import type { AssignmentStatus, Job, PaymentMethod } from "@/lib/db/types"
import type { Db } from "@/lib/ops/types"
import { formatDayLabel, formatTimeRange, localDate, localTime, parseHHMM } from "@/lib/scheduler/time"

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/** Minutes after local midnight of `date` for an instant, clamped to that day. */
export function minutesOfDay(ms: number, date: string): number {
  const d = new Date(ms)
  const ld = localDate(d)
  if (ld > date) return 1440
  if (ld < date) return 0
  return parseHHMM(localTime(d))
}

type AssignmentRow = { job_id: string; crew_id: string; status: AssignmentStatus; responded_at: string | null; notified_at: string | null }
type QuoteRow = { id: string; price_total: number; payment_method: PaymentMethod | null; paid_at: string | null }

/**
 * Turns job rows into what the schedule shows (customer, services, crew answers, quote / payment),
 * used by the schedule board (`/admin/schedule`) and the front page's Schedule stage. THROWS on a
 * query error.
 */
export async function loadScheduleJobs(db: Db, jobs: Job[]): Promise<(j: Job) => ScheduleJob> {
  const jobIds = jobs.map((j) => j.id)
  const customerIds = Array.from(new Set(jobs.map((j) => j.customer_id)))
  const quoteIds = Array.from(new Set(jobs.map((j) => j.quote_id).filter((q): q is string => !!q)))
  const none = Promise.resolve({ data: [], error: null })

  const [customers, assignments, items, quotes] = await Promise.all([
    customerIds.length ? db.from("customers").select("id,name,address,phone,email").in("id", customerIds) : none,
    jobIds.length ? db.from("job_assignments").select("job_id,crew_id,status,responded_at,notified_at").in("job_id", jobIds).neq("status", "dropped") : none,
    quoteIds.length ? db.from("quote_items").select("quote_id,description,sort_order,status").in("quote_id", quoteIds) : none,
    quoteIds.length ? db.from("quotes").select("id,price_total,payment_method,paid_at").in("id", quoteIds) : none,
  ])
  for (const r of [customers, assignments, items, quotes]) if (r.error) throw new Error(r.error.message)

  const assignmentRows = (assignments.data ?? []) as AssignmentRow[]
  const crewIds = Array.from(new Set(assignmentRows.map((a) => a.crew_id)))
  const crewRes = crewIds.length ? await db.from("profiles").select("id,name").in("id", crewIds) : { data: [], error: null }
  if (crewRes.error) throw new Error(crewRes.error.message)
  const crewName = new Map((crewRes.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const customer = new Map(
    (customers.data ?? []).map((c: { id: string; name: string; address: string | null; phone: string | null; email: string | null }) => [c.id, c]),
  )
  const quoteById = new Map(((quotes.data ?? []) as QuoteRow[]).map((q) => [q.id, q]))
  const servicesByQuote = new Map<string, string[]>()
  const needsOwnerByQuote = new Set<string>()
  for (const i of ((items.data ?? []) as { quote_id: string; description: string; sort_order: number; status: string }[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  )) {
    if (i.status === "needs_owner") needsOwnerByQuote.add(i.quote_id)
    if (i.status === "auto" || i.status === "priced") servicesByQuote.set(i.quote_id, [...(servicesByQuote.get(i.quote_id) ?? []), i.description])
  }

  const toScheduleJob = (j: Job): ScheduleJob => {
    const start = j.start_at ? new Date(j.start_at) : null
    const end = j.end_at ? new Date(j.end_at) : start ? new Date(start.getTime() + j.est_minutes * 60_000) : null
    const date = start ? localDate(start) : null
    const c = customer.get(j.customer_id)
    const q = j.quote_id ? quoteById.get(j.quote_id) : undefined
    return {
      id: j.id,
      status: j.status,
      weatherHold: j.weather_hold,
      ownerHold: j.owner_hold,
      paid: j.paid,
      customerName: c?.name ?? "Customer",
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      address: c?.address ?? null,
      services: j.quote_id ? (servicesByQuote.get(j.quote_id) ?? []) : [],
      crew: assignmentRows
        .filter((a) => a.job_id === j.id)
        .map((a): ScheduleCrew => {
          const name = crewName.get(a.crew_id) ?? "Crew"
          return { id: a.crew_id, name, initials: initials(name), status: a.status, respondedAt: a.responded_at, notified: !!a.notified_at }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      crewSize: j.crew_size,
      estMinutes: j.est_minutes,
      date,
      startMin: start && date ? minutesOfDay(start.getTime(), date) : null,
      endMin: end && date ? minutesOfDay(end.getTime(), date) : null,
      whenLabel: start && end ? `${formatDayLabel(start)}, ${formatTimeRange(start, end)}` : null,
      scheduleReason: j.schedule_reason,
      quote: q
        ? { id: q.id, priceTotal: Number(q.price_total), paymentMethod: q.payment_method, paidAt: q.paid_at, needsOwner: needsOwnerByQuote.has(q.id) }
        : null,
    }
  }

  return toScheduleJob
}
