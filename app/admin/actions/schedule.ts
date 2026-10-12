"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { checkMove } from "@/app/admin/schedule/conflicts"
import { requireOwner } from "@/lib/auth/session"
import type { AssignmentStatus, JobStatus } from "@/lib/db/types"
import { check, decideApproval, enqueueSchedule, transitionJob } from "@/lib/ops"
import type { Db } from "@/lib/ops"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const ACTIVE: AssignmentStatus[] = ["offered", "accepted", "swap_offered", "drop_requested"]
const LOCKED: JobStatus[] = ["in_progress", "done", "cancelled"]

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate() {
  revalidatePath("/admin/schedule")
  revalidatePath("/admin", "layout")
}

/** Reject any pending booking approval for this job: its slot/crew no longer stands. */
async function retireBookingApprovals(db: Db, jobId: string, actor: string, note: string) {
  const pending = check(
    await db.from("approvals").select("*").eq("kind", "booking").eq("status", "pending").eq("ref_id", jobId),
    "booking approvals",
  )
  for (const a of pending ?? []) {
    await decideApproval(db, a.id, "rejected", { decidedBy: actor, note })
  }
}

/** Drop a not-yet-run day-before reminder; a new booking re-enqueues it at the right time. */
async function clearQueuedReminder(db: Db, jobId: string) {
  check(
    await db.from("fleet_tasks").delete().eq("dedupe_key", `reminder:${jobId}`).eq("status", "queued"),
    "clear reminder",
  )
}

/**
 * Drag-to-move. Re-checks owner hours and every assigned crew member (free, available that
 * weekday, no approved time off). A `booked` / `crew_confirmed` job goes back to `proposed` and
 * accepted crew are re-asked (assignments back to `offered`).
 */
export async function moveJob(jobId: string, newStartISO: string): Promise<ActionResult> {
  const session = await requireOwner()
  const parsed = z.object({ jobId: idSchema, start: z.string().datetime({ offset: true }) }).safeParse({ jobId, start: newStartISO })
  if (!parsed.success) return { ok: false, reason: "Invalid move." }
  try {
    const db = requireSupabaseAdmin()
    const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "job")
    if (!job) return { ok: false, reason: "Job not found." }
    if (LOCKED.includes(job.status)) return { ok: false, reason: `A ${job.status.replace("_", " ")} job can't be moved.` }
    if (job.status === "unscheduled") return { ok: false, reason: "Let the scheduler place this job and pick its crew first." }

    const start = new Date(parsed.data.start)
    const minutes =
      job.start_at && job.end_at
        ? Math.round((Date.parse(job.end_at) - Date.parse(job.start_at)) / 60_000)
        : Math.max(30, job.est_minutes)
    const end = new Date(start.getTime() + minutes * 60_000)
    if (job.start_at && Date.parse(job.start_at) === start.getTime()) return { ok: true, message: "No change." }

    const assignments =
      check(await db.from("job_assignments").select("*").eq("job_id", jobId).in("status", ACTIVE), "assignments") ?? []
    const crewIds = Array.from(new Set(assignments.map((a) => a.crew_id)))
    const date = localDate(start)

    // Jobs that overlap the new slot (any crew); then which of our crew are on them.
    const overlapping =
      check(
        await db
          .from("jobs")
          .select("id,start_at,end_at")
          .neq("id", jobId)
          .not("status", "in", "(cancelled,done)")
          .lt("start_at", end.toISOString())
          .gt("end_at", start.toISOString()),
        "overlapping jobs",
      ) ?? []
    const jobTimes = new Map(overlapping.map((j) => [j.id, j]))
    const none = Promise.resolve({ data: [], error: null })

    const [crew, windows, ownerExceptions, blocks, crewExceptions, others] = await Promise.all([
      crewIds.length ? db.from("profiles").select("id,name").in("id", crewIds) : none,
      db.from("owner_windows").select("*"),
      db.from("owner_exceptions").select("*").eq("date", date),
      crewIds.length ? db.from("crew_availability").select("*").in("crew_id", crewIds) : none,
      crewIds.length
        ? db.from("crew_exceptions").select("*").in("crew_id", crewIds).eq("status", "approved").lte("date_from", date).gte("date_to", date)
        : none,
      crewIds.length && jobTimes.size
        ? db.from("job_assignments").select("crew_id,job_id,status").in("crew_id", crewIds).in("status", ACTIVE).in("job_id", Array.from(jobTimes.keys()))
        : none,
    ])
    const otherRows = (check(others, "other assignments") ?? []) as { crew_id: string; job_id: string; status: AssignmentStatus }[]

    const reason = checkMove({
      jobId,
      start,
      end,
      crew: (check(crew, "crew") ?? []) as { id: string; name: string }[],
      ownerWindows: check(windows, "owner windows") ?? [],
      ownerExceptions: check(ownerExceptions, "owner exceptions") ?? [],
      crewAvailability: check(blocks, "crew availability") ?? [],
      crewExceptions: check(crewExceptions, "crew exceptions") ?? [],
      otherAssignments: otherRows
        .filter((a) => jobTimes.has(a.job_id))
        .map((a) => ({ ...a, start_at: jobTimes.get(a.job_id)!.start_at, end_at: jobTimes.get(a.job_id)!.end_at })),
    })
    if (reason) return { ok: false, reason }

    const reconfirm = job.status === "booked" || job.status === "crew_confirmed"
    const accepted = assignments.filter((a) => a.status === "accepted")
    const patch: { start_at: string; end_at: string; status?: JobStatus } = {
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    }
    if (reconfirm) patch.status = "proposed"
    const updated = check(
      await db.from("jobs").update(patch).eq("id", jobId).eq("status", job.status).select("id"),
      "move job",
    )
    if (!updated?.length) return { ok: false, reason: "The job changed while you were moving it. Refresh and try again." }

    if (accepted.length) {
      check(
        await db
          .from("job_assignments")
          .update({ status: "offered", responded_at: null })
          .in("id", accepted.map((a) => a.id)),
        "re-offer crew",
      )
    }
    const actor = session.profile.name || "owner"
    if (reconfirm) await retireBookingApprovals(db, jobId, actor, "Job moved on the schedule; crew re-asked.")
    await clearQueuedReminder(db, jobId)

    revalidate()
    return {
      ok: true,
      message: reconfirm || accepted.length ? "Job moved. The crew will be re-asked." : "Job moved.",
    }
  } catch (e) {
    return fail(e)
  }
}

/** Toggle a weather hold. Setting it asks the scheduler to re-solve that job. */
export async function setWeatherHold(jobId: string, hold: boolean): Promise<ActionResult> {
  await requireOwner()
  const parsed = z.object({ jobId: idSchema, hold: z.boolean() }).safeParse({ jobId, hold })
  if (!parsed.success) return { ok: false, reason: "Invalid request." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("jobs").update({ weather_hold: hold }).eq("id", jobId), "weather hold")
    await enqueueSchedule(db, hold ? "weather_hold" : "weather_hold_cleared", [jobId])
    revalidate()
    return { ok: true, message: hold ? "Weather hold set. The scheduler will re-plan it." : "Weather hold cleared." }
  } catch (e) {
    return fail(e)
  }
}

/** Cancel a job (refunds are a separate step on the quote). */
export async function cancelJob(jobId: string): Promise<ActionResult> {
  const session = await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  try {
    const db = requireSupabaseAdmin()
    const actor = session.profile.name || "owner"
    await transitionJob(db, jobId, "cancelled", { actor })
    await retireBookingApprovals(db, jobId, actor, "Job cancelled.")
    await clearQueuedReminder(db, jobId)
    revalidate()
    return { ok: true, message: "Job cancelled." }
  } catch (e) {
    return fail(e)
  }
}

/** Ask the scheduler worker to run now (de-duped per 15 minutes). */
export async function runScheduler(): Promise<ActionResult> {
  await requireOwner()
  try {
    await enqueueSchedule(requireSupabaseAdmin(), "owner_requested")
    revalidate()
    return { ok: true, message: "The scheduler will run shortly." }
  } catch (e) {
    return fail(e)
  }
}
