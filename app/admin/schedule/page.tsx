import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { ScheduleBoard } from "@/components/admin/schedule/schedule-board"
import type { ScheduleDay } from "@/components/admin/schedule/types"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { Job } from "@/lib/db/types"
import { ownerOpenForDay } from "@/lib/scheduler/capacity"
import { addDays, localDate, weekStart, zonedToUtc } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { loadScheduleJobs, minutesOfDay } from "./load"

export const dynamic = "force-dynamic"
export const metadata = { title: "Schedule" }

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number)
  return `${MONTH[m - 1]} ${d}`
}

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
  const toScheduleJob = await loadScheduleJobs(db, jobs)

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
