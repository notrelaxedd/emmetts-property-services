import { ArrowLeft, Clock, StickyNote } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { JobActions } from "@/components/crew/job-actions"
import { JobCard } from "@/components/crew/job-card"
import { OfferActions } from "@/components/crew/offer-actions"
import { formatDuration, jobDay } from "@/components/crew/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { requireCrew } from "@/lib/auth/session"
import type { AssignmentStatus, CrewJob, JobAssignment } from "@/lib/db/types"
import { getSettings } from "@/lib/ops"
import { isInsideNoticeWindow, localDate } from "@/lib/scheduler"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Job" }

const STILL_ON: readonly AssignmentStatus[] = ["offered", "accepted", "swap_offered", "drop_requested"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CrewJobPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound()
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  const [{ data: jobRow }, { data: mineRow }] = await Promise.all([
    supabase.from("crew_jobs").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("job_assignments").select("*").eq("job_id", params.id).eq("crew_id", profile.id).maybeSingle(),
  ])
  const job = jobRow as CrewJob | null
  const mine = mineRow as JobAssignment | null
  // Only jobs I'm still on (the view filters too; this also hides a stale row from a race).
  if (!job || !mine || !STILL_ON.includes(mine.status)) notFound()

  // Service-role reads, scoped to this job I'm on: notice window, my open swap, who could take it.
  let insideNotice = false
  let noticeHours = 24
  let openSwaps = 0
  let eligibleForSwap = 0
  let photoCount = 0
  const admin = getSupabaseAdmin()
  if (admin) {
    const [settings, swaps, crew, onJob, jobPhotos] = await Promise.all([
      getSettings(admin).catch(() => null),
      admin
        .from("job_assignments")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("swap_to_crew_id", profile.id)
        .eq("status", "swap_offered"),
      admin.from("profiles").select("id").eq("role", "crew").eq("paused", false).neq("id", profile.id),
      admin.from("job_assignments").select("crew_id").eq("job_id", job.id),
      admin.from("jobs").select("completion_photo_paths").eq("id", job.id).maybeSingle(),
    ])
    if (settings) {
      noticeHours = settings.drop_notice_hours
      insideNotice = isInsideNoticeWindow(job, new Date(), settings)
    }
    openSwaps = swaps.count ?? 0
    const taken = new Set((onJob.data ?? []).map((a) => a.crew_id))
    eligibleForSwap = (crew.data ?? []).filter((p) => !taken.has(p.id)).length
    photoCount = jobPhotos.data?.completion_photo_paths?.length ?? 0
  }

  const today = localDate(new Date())
  const startsToday = !job.start_at || localDate(new Date(job.start_at)) <= today

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/crew"
        className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-ink hover:bg-ink/[0.06]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Today
      </Link>

      <h1 className="sr-only">
        {job.customer_name} — {jobDay(job)}
      </h1>

      <JobCard job={job} assignmentStatus={mine.status} showDay>
        {mine.status === "offered" || mine.status === "swap_offered" ? (
          <OfferActions assignmentId={mine.id} swap={mine.status === "swap_offered"} />
        ) : null}
      </JobCard>

      {job.notes ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="size-4 text-ink-muted" aria-hidden="true" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-ink">{job.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {job.status === "done" ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <Clock className="size-5 text-brand-green-dark" aria-hidden="true" />
            <p className="text-sm text-ink">
              Finished
              {job.actual_minutes != null ? ` in ${formatDuration(job.actual_minutes)}` : ""}
              {photoCount ? ` · ${photoCount} photo${photoCount === 1 ? "" : "s"}` : ""}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {mine.status === "accepted" ? (
        <JobActions
          jobId={job.id}
          jobStatus={job.status}
          estMinutes={job.est_minutes}
          startsToday={startsToday}
          insideNotice={insideNotice}
          noticeHours={noticeHours}
          openSwaps={openSwaps}
          eligibleForSwap={eligibleForSwap}
          photoCount={photoCount}
        />
      ) : null}

      {mine.status === "drop_requested" ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          You asked to drop this job. You&rsquo;re still on it until the owner says OK.
        </p>
      ) : null}
    </div>
  )
}
