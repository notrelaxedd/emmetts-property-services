import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { ScheduleBoard } from "@/components/admin/schedule/schedule-board"
import type { ScheduleCrew, ScheduleDay, ScheduleJob } from "@/components/admin/schedule/types"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { Job } from "@/lib/db/types"
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

async function loadWeek(monday: string) {
  const db = requireSupabaseAdmin()
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const from = zonedToUtc(monday, "00:00").toISOString()
  const to = zonedToUtc(addDays(monday, 7), "00:00").toISOString()

  const [weekJobs, railJobs, windows, exceptions] = await Promise.all([
    db.from("jobs").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
    db.from("jobs").select("*").is("start_at", null).not("status", "in", "(cancelled,done)").order("paid_at", { ascending: true }).limit(100),
    db.from("owner_windows").select("*"),
    db.from("owner_exceptions").select("*").gte("date", dates[0]).lte("date", dates[6]),
  ])
  for (const r of [weekJobs, railJobs, windows, exceptions]) if (r.error) throw new Error(r.error.message)

  const jobs: Job[] = [...(weekJobs.data ?? []), ...(railJobs.data ?? [])]
  const jobIds = jobs.map((j) => j.id)
  const customerIds = Array.from(new Set(jobs.map((j) => j.customer_id)))
  const quoteIds = Array.from(new Set(jobs.map((j) => j.quote_id).filter((q): q is string => !!q)))

  const [customers, assignments, items] = await Promise.all([
    customerIds.length ? db.from("customers").select("id,name,address").in("id", customerIds) : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? db.from("job_assignments").select("job_id,crew_id,status").in("job_id", jobIds).not("status", "in", "(declined,dropped)")
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length
      ? db.from("quote_items").select("quote_id,description,sort_order,status").in("quote_id", quoteIds).in("status", ["auto", "priced"])
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [customers, assignments, items]) if (r.error) throw new Error(r.error.message)

  const assignmentRows = (assignments.data ?? []) as { job_id: string; crew_id: string; status: ScheduleCrew["status"] }[]
  const crewIds = Array.from(new Set(assignmentRows.map((a) => a.crew_id)))
  const crewRes = crewIds.length ? await db.from("profiles").select("id,name").in("id", crewIds) : { data: [], error: null }
  if (crewRes.error) throw new Error(crewRes.error.message)
  const crewName = new Map((crewRes.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const customer = new Map(
    (customers.data ?? []).map((c: { id: string; name: string; address: string | null }) => [c.id, c]),
  )
  const servicesByQuote = new Map<string, string[]>()
  for (const i of ((items.data ?? []) as { quote_id: string; description: string; sort_order: number }[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  )) {
    servicesByQuote.set(i.quote_id, [...(servicesByQuote.get(i.quote_id) ?? []), i.description])
  }

  const toScheduleJob = (j: Job): ScheduleJob => {
    const start = j.start_at ? new Date(j.start_at) : null
    const end = j.end_at ? new Date(j.end_at) : start ? new Date(start.getTime() + j.est_minutes * 60_000) : null
    const date = start ? localDate(start) : null
    return {
      id: j.id,
      status: j.status,
      weatherHold: j.weather_hold,
      paid: j.paid,
      customerName: customer.get(j.customer_id)?.name ?? "Customer",
      address: customer.get(j.customer_id)?.address ?? null,
      services: j.quote_id ? (servicesByQuote.get(j.quote_id) ?? []) : [],
      crew: assignmentRows
        .filter((a) => a.job_id === j.id)
        .map((a) => {
          const name = crewName.get(a.crew_id) ?? "Crew"
          return { id: a.crew_id, name, initials: initials(name), status: a.status }
        }),
      crewSize: j.crew_size,
      estMinutes: j.est_minutes,
      date,
      startMin: start && date ? minutesOfDay(start.getTime(), date) : null,
      endMin: end && date ? minutesOfDay(end.getTime(), date) : null,
      whenLabel: start && end ? `${formatDayLabel(start)}, ${formatTimeRange(start, end)}` : null,
      scheduleReason: j.schedule_reason,
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
    jobs: (weekJobs.data ?? []).map(toScheduleJob),
    unscheduled: (railJobs.data ?? []).map(toScheduleJob),
    hasWindows: (windows.data ?? []).length > 0,
  }
}

export default async function SchedulePage({ searchParams }: { searchParams: { week?: string } }) {
  await requireOwner()
  const today = localDate(new Date())
  const param = typeof searchParams.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week) ? searchParams.week : today
  let monday: string
  try {
    monday = weekStart(param)
  } catch {
    monday = weekStart(today)
  }
  const sunday = addDays(monday, 6)
  const title = `${shortDate(monday)} – ${shortDate(sunday)}, ${sunday.slice(0, 4)}`

  let data: Awaited<ReturnType<typeof loadWeek>> | null = null
  let error: string | null = null
  try {
    data = await loadWeek(monday)
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
        <ScheduleBoard days={data.days} jobs={data.jobs} unscheduled={data.unscheduled} hasWindows={data.hasWindows} />
      )}
    </div>
  )
}
