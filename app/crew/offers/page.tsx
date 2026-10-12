import { HandHelping } from "lucide-react"
import { JobCard } from "@/components/crew/job-card"
import { OfferActions } from "@/components/crew/offer-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireCrew } from "@/lib/auth/session"
import type { CrewJob, JobAssignment } from "@/lib/db/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Offers" }

export default async function CrewOffersPage() {
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  // Normal offers and swap offers are both my own rows (crew_id = me), so RLS lets me read them
  // and crew_jobs lets me see the job.
  const { data: rows, error } = await supabase
    .from("job_assignments")
    .select("*")
    .eq("crew_id", profile.id)
    .in("status", ["offered", "swap_offered"])
    .order("created_at", { ascending: true })
  const offers = (rows ?? []) as JobAssignment[]

  const jobIds = Array.from(new Set(offers.map((o) => o.job_id)))
  const { data: jobRows } = jobIds.length
    ? await supabase.from("crew_jobs").select("*").in("id", jobIds)
    : { data: [] as CrewJob[] }
  const jobs = new Map(((jobRows ?? []) as CrewJob[]).map((j) => [j.id, j]))

  // First names of whoever is handing a job over (crew can't read other profiles through RLS).
  const fromIds = Array.from(new Set(offers.map((o) => o.swap_to_crew_id).filter((x): x is string => !!x)))
  const names = new Map<string, string>()
  const admin = fromIds.length ? getSupabaseAdmin() : null
  if (admin) {
    const { data } = await admin.from("profiles").select("id, name").in("id", fromIds)
    for (const p of data ?? []) names.set(p.id, p.name.trim().split(/\s+/)[0] || "a teammate")
  }

  const now = Date.now()
  const live = offers
    .map((o) => ({ offer: o, job: jobs.get(o.job_id) }))
    .filter((x): x is { offer: JobAssignment; job: CrewJob } => {
      if (!x.job || x.job.status === "cancelled" || x.job.status === "done") return false
      return !x.job.end_at || Date.parse(x.job.end_at) > now
    })
    .sort((a, b) => (a.job.start_at ?? "").localeCompare(b.job.start_at ?? ""))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Offers" description="Jobs waiting for your yes or no." />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&rsquo;t load offers</AlertTitle>
          <AlertDescription>Try again in a minute.</AlertDescription>
        </Alert>
      ) : null}

      {live.length === 0 && !error ? (
        <EmptyState
          icon={HandHelping}
          title="No offers right now"
          description={
            profile.paused
              ? "You're paused, so no new jobs are being offered. Turn it off in Hours."
              : "When the scheduler picks you for a job, it shows up here."
          }
        />
      ) : null}

      {live.map(({ offer, job }) => {
        const swap = offer.status === "swap_offered"
        const from = offer.swap_to_crew_id ? names.get(offer.swap_to_crew_id) : undefined
        return (
          <JobCard
            key={offer.id}
            job={job}
            showDay
            eyebrow={swap ? `Swap — ${from ?? "a teammate"} can’t make it. First to take it gets it.` : undefined}
          >
            {job.notes ? <p className="whitespace-pre-line text-sm text-ink">{job.notes}</p> : null}
            <OfferActions assignmentId={offer.id} swap={swap} />
          </JobCard>
        )
      })}
    </div>
  )
}
