import "server-only"
import { revalidatePath } from "next/cache"
import { requireCrew, type Session } from "@/lib/auth/session"
import type { CrewJob, JobAssignment } from "@/lib/db/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { formatDayLabel, formatTimeRange } from "@/lib/scheduler"

/** Every crew server action returns this shape; the client shows `error` / `message` in a toast. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export type CrewContext = {
  session: Session
  /** profiles.id — the `crew_id` used in every crew table. */
  me: string
  /** RLS-respecting client acting as the signed-in crew member. */
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>
}

/**
 * Session + RLS client for a crew action. `requireCrew()` redirects when signed out, so call this
 * OUTSIDE any try/catch (the redirect is thrown).
 */
export async function crewContext(): Promise<CrewContext | null> {
  const session = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return null
  return { session, me: session.profile.id, supabase }
}

export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  return raw.replace(/\/$/, "")
}

/** Re-render every crew page (they all read the same few tables). */
export function revalidateCrew() {
  revalidatePath("/crew", "layout")
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Something went wrong. Try again."
}

/** "Tue Oct 14 9:00–10:30am", or "unscheduled". */
export function slotLabel(job: Pick<CrewJob, "start_at" | "end_at">): string {
  if (!job.start_at) return "unscheduled"
  const start = new Date(job.start_at)
  if (!job.end_at) return formatDayLabel(start)
  return `${formatDayLabel(start)} ${formatTimeRange(start, new Date(job.end_at))}`
}

/** My assignment row on a job, read through RLS. */
export async function myAssignment(ctx: CrewContext, jobId: string): Promise<JobAssignment | null> {
  const { data, error } = await ctx.supabase
    .from("job_assignments")
    .select("*")
    .eq("job_id", jobId)
    .eq("crew_id", ctx.me)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as JobAssignment | null) ?? null
}

/** The crew-safe job row, read through RLS (null when I'm not on the job). */
export async function crewJob(ctx: CrewContext, jobId: string): Promise<CrewJob | null> {
  const { data, error } = await ctx.supabase.from("crew_jobs").select("*").eq("id", jobId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CrewJob | null) ?? null
}
