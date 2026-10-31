"use server"

// Registers the per-kind side effects before anything calls `applyApproval`.
import "@/lib/ops/handlers"
import { z } from "zod"
import type { JobStatus } from "@/lib/db/types"
import {
  applyApproval,
  dropAssignmentKeepSlot,
  finishJob,
  getSettings,
  maybeConfirmJob,
  requestApproval,
  transitionJob,
} from "@/lib/ops"
import { isInsideNoticeWindow, localDate } from "@/lib/scheduler"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import {
  crewContext,
  crewJob,
  errorMessage,
  fail,
  myAssignment,
  revalidateCrew,
  siteUrl,
  slotLabel,
  type ActionResult,
} from "./shared"

const jobIdSchema = z.string().uuid()

/** Job statuses where an accepted crew member may still hand the job off (swap / drop). */
const HANDOFF_JOB_STATUSES: readonly JobStatus[] = ["proposed", "crew_confirmed", "booked"]

const PHOTO_BUCKET = "lead-photos"
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
}
const MAX_PHOTOS_PER_JOB = 12

/**
 * Offer my spot on a job to every eligible crew member (role crew, not paused, not already on the
 * job). One row per candidate: `{ job_id, crew_id: candidate, status: "swap_offered",
 * swap_to_crew_id: me }` — `job_assignments` is unique per (job, crew), so the candidate owns the
 * row (and can read / answer it through RLS) and `swap_to_crew_id` records who is handing it over.
 * The first to accept takes the job (see `respondToOffer`).
 */
export async function offerSwap(jobId: string): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(jobId)
  if (!id.success) return fail("That job link isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const [mine, job] = await Promise.all([myAssignment(ctx, id.data), crewJob(ctx, id.data)])
    if (!mine || !job || mine.crew_id !== ctx.me) return fail("You're not on this job.")
    if (mine.status !== "accepted") return fail("Only a job you've accepted can be swapped.")
    if (!HANDOFF_JOB_STATUSES.includes(job.status)) return fail("This job can't be swapped any more.")

    const db = requireSupabaseAdmin()
    const [{ data: crew, error: crewErr }, { data: onJob, error: onErr }] = await Promise.all([
      db.from("profiles").select("id").eq("role", "crew").eq("paused", false).is("removed_at", null).neq("id", ctx.me),
      db.from("job_assignments").select("crew_id").eq("job_id", id.data),
    ])
    if (crewErr) throw new Error(crewErr.message)
    if (onErr) throw new Error(onErr.message)
    const taken = new Set((onJob ?? []).map((a) => a.crew_id))
    const eligible = (crew ?? []).filter((p) => !taken.has(p.id))
    if (eligible.length === 0) return fail("Nobody else is free to take it. Try Drop instead.")

    const { error } = await db.from("job_assignments").insert(
      eligible.map((p) => ({
        job_id: id.data,
        crew_id: p.id,
        status: "swap_offered" as const,
        swap_to_crew_id: ctx.me,
        responded_at: null,
      })),
    )
    if (error) throw new Error(error.message)
    revalidateCrew()
    return {
      ok: true,
      message: `Offered to ${eligible.length} crew member${eligible.length === 1 ? "" : "s"}. You keep the job until someone accepts.`,
    }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** Withdraw a pending swap I offered. */
export async function cancelSwap(jobId: string): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(jobId)
  if (!id.success) return fail("That job link isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const mine = await myAssignment(ctx, id.data)
    if (!mine || mine.crew_id !== ctx.me) return fail("You're not on this job.")
    const db = requireSupabaseAdmin()
    const { error } = await db
      .from("job_assignments")
      .delete()
      .eq("job_id", id.data)
      .eq("swap_to_crew_id", ctx.me)
      .eq("status", "swap_offered")
    if (error) throw new Error(error.message)
    // Swap rows never block confirmation, but re-check in case this was the last thing outstanding.
    await maybeConfirmJob(db, id.data, { siteUrl: siteUrl(), actor: "crew-app" })
    revalidateCrew()
    return { ok: true, message: "Swap cancelled. The job is still yours." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/**
 * Drop a job I accepted. Inside the notice window → my row becomes `drop_requested` and a `drop`
 * approval `{ assignment_id, job_id }` goes to the owner (applied straight away when drop autopilot
 * is on). Outside it → my row is `dropped` and the job KEEPS its slot and the rest of its crew: it is
 * marked for cover (`resolve_reason = 'drop'`) and the scheduler offers the gap to someone else.
 * A booked job stays booked; a crew_confirmed one goes back to proposed (its pending "Book" card is
 * withdrawn) so the replacement's acceptance re-confirms it. See `releaseCrewFromJob`.
 */
export async function dropJob(jobId: string): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(jobId)
  if (!id.success) return fail("That job link isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const [mine, job] = await Promise.all([myAssignment(ctx, id.data), crewJob(ctx, id.data)])
    if (!mine || !job || mine.crew_id !== ctx.me) return fail("You're not on this job.")
    if (mine.status !== "accepted") return fail("Only a job you've accepted can be dropped.")
    if (!HANDOFF_JOB_STATUSES.includes(job.status)) return fail("This job has already started or ended.")

    const db = requireSupabaseAdmin()
    const settings = await getSettings(db)
    const now = new Date()

    // A drop supersedes any swap I had out for this job.
    await db
      .from("job_assignments")
      .delete()
      .eq("job_id", id.data)
      .eq("swap_to_crew_id", ctx.me)
      .eq("status", "swap_offered")

    if (isInsideNoticeWindow(job, now, settings)) {
      const { error } = await ctx.supabase
        .from("job_assignments")
        .update({ status: "drop_requested", responded_at: now.toISOString() })
        .eq("id", mine.id)
        .eq("crew_id", ctx.me)
        .eq("status", "accepted")
      if (error) throw new Error(error.message)
      const { approval, autoApproved } = await requestApproval(
        db,
        {
          kind: "drop",
          ref_table: "job_assignments",
          ref_id: mine.id,
          payload: { assignment_id: mine.id, job_id: id.data },
          title: `${ctx.session.profile.name || "A crew member"} wants to drop ${job.customer_name} — ${slotLabel(job)}`,
          summary: `Inside the ${settings.drop_notice_hours} h notice window`,
          created_by: "crew-app",
        },
        settings,
      )
      if (autoApproved) {
        await applyApproval(db, approval, { siteUrl: siteUrl(), actor: "autopilot" })
        revalidateCrew()
        return { ok: true, message: "Dropped. We'll find cover." }
      }
      revalidateCrew()
      return { ok: true, message: "It's close to the start, so the owner has to OK it. You're still on it until then." }
    }

    // Crew can't set `dropped` themselves (guard trigger); ownership was checked above.
    const changed = await dropAssignmentKeepSlot(
      db,
      { job_id: id.data, crew_id: ctx.me },
      { actor: `crew:${ctx.me}`, from: ["accepted"], taskReason: "drop" },
    )
    if (!changed) return fail("You've already left this job.")
    revalidateCrew()
    return { ok: true, message: "Dropped. We'll find cover." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** Start a booked job I'm on. */
export async function startJob(jobId: string): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(jobId)
  if (!id.success) return fail("That job link isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const [mine, job] = await Promise.all([myAssignment(ctx, id.data), crewJob(ctx, id.data)])
    if (!mine || !job || mine.crew_id !== ctx.me || mine.status !== "accepted") return fail("You're not on this job.")
    if (job.status === "in_progress") return { ok: true, message: "Already started." }
    if (job.status !== "booked") return fail("Only a booked job can be started.")
    if (job.start_at && localDate(new Date(job.start_at)) > localDate(new Date())) {
      return fail("This job isn't until a later day.")
    }
    await transitionJob(requireSupabaseAdmin(), id.data, "in_progress", { actor: `crew:${ctx.me}` })
    revalidateCrew()
    return { ok: true, message: "Started. Tap Complete when you're done." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/**
 * Upload one completion photo (the client calls this once per photo so each request stays under
 * the server-action body limit). Stored in the private `lead-photos` bucket at
 * `jobs/<jobId>/<n>.<ext>` and appended to `jobs.completion_photo_paths`.
 */
export async function uploadJobPhoto(formData: FormData): Promise<ActionResult> {
  const id = jobIdSchema.safeParse(formData.get("jobId"))
  const file = formData.get("photo")
  if (!id.success) return fail("That job link isn't valid.")
  if (!(file instanceof File) || file.size === 0) return fail("No photo attached.")
  const ext = PHOTO_TYPES[file.type]
  if (!ext) return fail("Photos must be JPG, PNG, WebP or HEIC.")
  if (file.size > MAX_PHOTO_BYTES) return fail("That photo is too big (10 MB max).")

  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const mine = await myAssignment(ctx, id.data)
    if (!mine || mine.crew_id !== ctx.me || mine.status !== "accepted") return fail("You're not on this job.")

    const db = requireSupabaseAdmin()
    const { data: job, error } = await db
      .from("jobs")
      .select("status, completion_photo_paths")
      .eq("id", id.data)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!job) return fail("Job not found.")
    if (job.status !== "in_progress" && job.status !== "booked") return fail("Photos can only be added while the job is on.")
    const existing = job.completion_photo_paths ?? []
    if (existing.length >= MAX_PHOTOS_PER_JOB) return fail(`That's the limit of ${MAX_PHOTOS_PER_JOB} photos.`)

    const bytes = new Uint8Array(await file.arrayBuffer())
    let n = existing.length + 1
    let path = `jobs/${id.data}/${n}.${ext}`
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error: upErr } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false })
      if (!upErr) break
      if (attempt === 4 || !/exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message)
      n += 1
      path = `jobs/${id.data}/${n}.${ext}`
    }

    const { error: saveErr } = await db
      .from("jobs")
      .update({ completion_photo_paths: [...existing, path] })
      .eq("id", id.data)
    if (saveErr) throw new Error(saveErr.message)
    return { ok: true }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

const completeSchema = z.object({
  jobId: z.string().uuid(),
  hours: z.number().min(0.25).max(24),
})

/**
 * Finish a job: record actual time, mark it `done`, write one payout per accepted crew member
 * (hours × their own hourly_rate) and queue the review follow-up for 24 h later.
 */
export async function completeJob(input: { jobId: string; hours: number }): Promise<ActionResult> {
  const parsed = completeSchema.safeParse(input)
  if (!parsed.success) return fail("Enter the hours you worked (at least 15 minutes).")
  const { jobId, hours } = parsed.data
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const [mine, job] = await Promise.all([myAssignment(ctx, jobId), crewJob(ctx, jobId)])
    if (!mine || !job || mine.crew_id !== ctx.me || mine.status !== "accepted") return fail("You're not on this job.")
    if (job.status === "done") return { ok: true, message: "Already marked complete." }
    if (job.status !== "in_progress" && job.status !== "booked") return fail("Only a job that's on can be completed.")

    await finishJob(requireSupabaseAdmin(), jobId, { hours, actor: `crew:${ctx.me}` })
    revalidateCrew()
    return { ok: true, message: "Nice work — job complete." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}
