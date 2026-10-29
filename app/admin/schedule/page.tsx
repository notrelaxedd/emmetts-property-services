import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { ScheduleBoard } from "@/components/admin/schedule/schedule-board"
import type { ScheduleCrew, ScheduleDay, ScheduleJob } from "@/components/admin/schedule/types"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { AssignmentStatus, Job, PaymentMethod } from "@/lib/db/types"
import { ownerOpenForDay } from "@/lib/scheduler/capacity"
import {
  addDays,
  formatDayLabel,
  formatTimeRange,
  localDate,
  localTime,
  parseHHMM,
  weekStart,
  zonedToUtc,
} from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Schedule" }

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/** Minutes after local midnight of `date` for an instant, clamped to that day. */
function minutesOfDay(ms: number, date: string): number {
  const d = new Date(ms)
  const ld = localDate(d)
  if (ld > date) return 1440
  if (ld < date) return 0
  return parseHHMM(localTime(d))
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number)
  return `${MONTH[m - 1]} ${d}`
}

type AssignmentRow = { job_id: string; crew_id: string; status: AssignmentStatus; responded_at: string | null; notified_at: string | null }
type QuoteRow = { id: string; price_total: number; payment_method: PaymentMethod | null; paid_at: string | null }

async function loadWeek(monday: string, focusJobId: string | null) {
  const db = requireSupabaseAdmin()
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const from = zonedToUtc(monday, "00:00").toISOString()
  const to = zonedToUtc(addDays(monday, 7), "00:00").toISOString()

  const [weekJobs, railJobs, windows, exceptions, focus] = await Promise.all([
    db.from("jobs").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
    db.from("jobs").select("*").is("start_at", null).not("status", "in", "(cancelled,done)").order("created_at", { ascending: true }).limit(100),
    db.from("owner_windows").select("*"),
    db.from("owner_exceptions").select("*").gte("date", dates[0]).lte("date", dates[6]),
    focusJobId ? db.from("jobs").select("*").eq("id", focusJobId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  for (const r of [weekJobs, railJobs, windows, exceptions, focus]) if (r.error) throw new Error(r.error.message)

  const week = [...(weekJobs.data ?? [])]
  const rail = [...(railJobs.data ?? [])]
  // A job linked from elsewhere (?job=) that isn't in this week or on the rail still opens in the dialog.
  const extra: Job[] = focus.data && !week.some((j) => j.id === focus.data!.id) && !rail.some((j) => j.id === focus.data!.id) ? [focus.data] : []
  const jobs: Job[] = [...week, ...rail, ...extra]
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

  const today = localDate(new Date())
  const days: ScheduleDay[] = dates.map((date) => {
    const exs = (exceptions.data ?? []).filter((e) => e.date.slice(0, 10) === date)
    return {
      date,
      weekday: WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()],
      label: shortDate(date),
      isToday: date === today,
      open: ownerOpenForDay(date, windows.data ?? [], exceptions.data ?? []).map((iv) => ({
        startMin: minutesOfDay(iv.start, date),
        endMin: minutesOfDay(iv.end, date),
      })),
      note: exs.map((e) => e.note).filter(Boolean).join("; ") || null,
      closed: exs.some((e) => e.closed),
    }
  })

  return {
    days,
    jobs: week.map(toScheduleJob),
    unscheduled: rail.map(toScheduleJob),
    extra: extra.map(toScheduleJob),
    hasWindows: (windows.data ?? []).length > 0,
  }
}

export default async function SchedulePage({ searchParams }: { searchParams: { week?: string; job?: string } }) {
  await requireOwner()
  const today = localDate(new Date())
  const focusJobId = typeof searchParams.job === "string" && UUID.test(searchParams.job) ? searchParams.job : null
  let param = typeof searchParams.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week) ? searchParams.week : null
  if (!param && focusJobId) {
    // Open the week the linked job is in.
    const { data } = await requireSupabaseAdmin().from("jobs").select("start_at").eq("id", focusJobId).maybeSingle()
    if (data?.start_at) param = localDate(new Date(data.start_at))
  }
  let monday: string
  try {
    monday = weekStart(param ?? today)
  } catch {
    monday = weekStart(today)
  }
  const sunday = addDays(monday, 6)
  const title = `${shortDate(monday)} – ${shortDate(sunday)}, ${sunday.slice(0, 4)}`

  let data: Awaited<ReturnType<typeof loadWeek>> | null = null
  let error: string | null = null
  try {
    data = await loadWeek(monday, focusJobId)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule"
        description={title}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/schedule?week=${addDays(monday, -7)}`} aria-label="Previous week">
                <ChevronLeft /> Prev
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/schedule">This week</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/schedule?week=${addDays(monday, 7)}`} aria-label="Next week">
                Next <ChevronRight />
              </Link>
            </Button>
          </>
        }
      />
      {error || !data ? (
        <EmptyState icon={CalendarDays} title="Couldn't load the schedule" description={error ?? undefined} />
      ) : (
        <ScheduleBoard
          days={data.days}
          jobs={data.jobs}
          unscheduled={data.unscheduled}
          extra={data.extra}
          hasWindows={data.hasWindows}
          focusJobId={focusJobId}
        />
      )}
    </div>
  )
}
