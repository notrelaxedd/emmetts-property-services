import { CalendarCheck, ChevronRight, HandHelping, PauseCircle } from "lucide-react"
import Link from "next/link"
import { JobCard } from "@/components/crew/job-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireCrew } from "@/lib/auth/session"
import type { AssignmentStatus, CrewJob } from "@/lib/db/types"
import { addDays, formatDayLabel, localDate, zonedToUtc } from "@/lib/scheduler"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Today" }

const SHOWN: AssignmentStatus[] = ["accepted", "offered", "drop_requested"]

export default async function CrewTodayPage() {
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  const now = new Date()
  const today = localDate(now)
  const startIso = zonedToUtc(today, "00:00").toISOString()
  const endIso = zonedToUtc(addDays(today, 8), "00:00").toISOString()

  // crew_jobs only returns jobs I have an assignment on; the assignment join below narrows it to live ones.
  const [upcoming, running, offers] = await Promise.all([
    supabase
      .from("crew_jobs")
      .select("*")
      .gte("start_at", startIso)
      .lt("start_at", endIso)
      .neq("status", "cancelled")
      .order("start_at", { ascending: true }),
    supabase.from("crew_jobs").select("*").eq("status", "in_progress"),
    supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("crew_id", profile.id)
      .in("status", ["offered", "swap_offered"]),
  ])

  const byId = new Map<string, CrewJob>()
  for (const j of [...((running.data ?? []) as CrewJob[]), ...((upcoming.data ?? []) as CrewJob[])]) byId.set(j.id, j)
  const ids = Array.from(byId.keys())

  const { data: assignments } = ids.length
    ? await supabase.from("job_assignments").select("job_id, status").eq("crew_id", profile.id).in("job_id", ids)
    : { data: [] as { job_id: string; status: AssignmentStatus }[] }
  const statusByJob = new Map((assignments ?? []).map((a) => [a.job_id, a.status as AssignmentStatus]))

  const jobs = Array.from(byId.values())
    .filter((j) => SHOWN.includes(statusByJob.get(j.id) as AssignmentStatus))
    .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""))

  const groups = new Map<string, CrewJob[]>()
  for (const j of jobs) {
    const day = j.start_at ? localDate(new Date(j.start_at)) : today
    const key = day < today ? today : day
    groups.set(key, [...(groups.get(key) ?? []), j])
  }

  const dayHeading = (d: string) => {
    if (d === today) return "Today"
    if (d === addDays(today, 1)) return "Tomorrow"
    return formatDayLabel(zonedToUtc(d, "12:00"))
  }
  const offerCount = offers.count ?? 0
  const loadError = upcoming.error ?? running.error

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Today" description={`${formatDayLabel(now)} · your next 7 days`} />

      {profile.paused ? (
        <Alert variant="warning">
          <PauseCircle aria-hidden="true" />
          <AlertTitle>You&rsquo;re paused</AlertTitle>
          <AlertDescription>
            No new jobs will be offered. Jobs you already accepted still stand.{" "}
            <Link href="/crew/hours" className="font-semibold underline underline-offset-2">
              Change in Hours
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {offerCount > 0 ? (
        <Link
          href="/crew/offers"
          className="flex min-h-14 items-center gap-3 rounded-lg bg-brand-green px-4 py-3 font-semibold text-ink shadow-sm hover:brightness-95"
        >
          <HandHelping className="size-6 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {offerCount} job offer{offerCount === 1 ? "" : "s"} waiting for you
          </span>
          <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
        </Link>
      ) : null}

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&rsquo;t load your jobs</AlertTitle>
          <AlertDescription>Pull down to refresh, or try again in a minute.</AlertDescription>
        </Alert>
      ) : null}

      {groups.size === 0 && !loadError ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing on your schedule"
          description="Jobs you accept for the next 7 days show up here."
        />
      ) : null}

      {Array.from(groups.entries()).map(([day, dayJobs]) => (
        <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-3">
          <h2 id={`day-${day}`} className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            {dayHeading(day)}
          </h2>
          {dayJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              assignmentStatus={statusByJob.get(job.id)}
              href={statusByJob.get(job.id) === "offered" ? "/crew/offers" : `/crew/jobs/${job.id}`}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
