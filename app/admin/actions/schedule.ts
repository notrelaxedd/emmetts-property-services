"use server"

// Registers the per-kind side effects before anything calls `applyApproval`.
import "@/lib/ops/handlers"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { checkMove } from "@/app/admin/schedule/conflicts"
import { siteUrl } from "@/components/admin/inbox/server"
import { requireOwner } from "@/lib/auth/session"
import type { JobStatus } from "@/lib/db/types"
import {
  askCrewAgain,
  bookJob,
  check,
  clearQueuedReminder,
  clearWeatherHold,
  decideApproval,
  enqueueSchedule,
  holdForWeather,
  PAYMENT_METHODS,
  scheduleJobAt,
  setOwnerHold,
  slotMinutes,
  transitionJob,
  unplaceJob as unplaceJobCore,
  withdrawCallToConfirm,
} from "@/lib/ops"
import type { Db } from "@/lib/ops"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const LOCKED: JobStatus[] = ["in_progress", "done", "cancelled"]

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate() {
  revalidatePath("/admin/schedule")
  revalidatePath("/admin", "layout")
}

function actorOf(session: Awaited<ReturnType<typeof requireOwner>>): string {
  return session.email ?? session.profile.name ?? "owner"
}

/** Reject any pending legacy "Book" card for this job: its slot/crew no longer stands. The call card is handled by the core. */
async function retireLegacyBookingApprovals(db: Db, jobId: string, actor: string, note: string) {
  const pending = check(
    await db.from("approvals").select("*").eq("kind", "booking").eq("status", "pending").eq("ref_id", jobId),
    "booking approvals",
  )
  for (const a of pending ?? []) {
    if (a.payload.call_to_confirm === true || a.payload.unschedulable === true || a.payload.needs_cover === true) continue
    await decideApproval(db, a.id, "rejected", { decidedBy: actor, note })
  }
}

/**
 * Drag a quote from the "Needs a day" rail onto the calendar, or drag a placed job to another time.
 * Checks your open hours (not the crew: everyone who could work the new slot is asked by email and
 * says so themselves). A job the customer already confirmed goes back to "call to confirm" for the
 * new day.
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

    const start = new Date(parsed.data.start)
    const minutes =
      job.start_at && job.end_at
        ? Math.round((Date.parse(job.end_at) - Date.parse(job.start_at)) / 60_000)
        : slotMinutes(job.est_minutes)
    const end = new Date(start.getTime() + minutes * 60_000)
    if (job.start_at && Date.parse(job.start_at) === start.getTime()) return { ok: true, message: "No change." }

    const date = localDate(start)
    const [windows, ownerExceptions] = await Promise.all([
      db.from("owner_windows").select("*"),
      db.from("owner_exceptions").select("*").eq("date", date),
    ])
    const reason = checkMove({
      jobId,
      start,
      end,
      crew: [],
      ownerWindows: check(windows, "owner windows") ?? [],
      ownerExceptions: check(ownerExceptions, "owner exceptions") ?? [],
      crewAvailability: [],
      crewExceptions: [],
      otherAssignments: [],
    })
    if (reason) return { ok: false, reason }

    const actor = actorOf(session)
    const wasPlaced = job.status !== "unscheduled"
    const res = await scheduleJobAt(db, jobId, start, end, { actor, siteUrl: siteUrl() })
    await retireLegacyBookingApprovals(db, jobId, actor, "Job moved on the schedule; crew re-asked.")
    revalidate()

    const crewLine =
      res.asked === 0
        ? "No crew member can work that slot (hours, time off or another job), so nobody was asked."
        : `${res.asked} crew member${res.asked === 1 ? "" : "s"} asked${res.emailed ? ` (${res.emailed} emailed)` : ""}.`
    const next = res.reconfirm
      ? " The customer had confirmed the old day: call them to re-confirm."
      : " Call the customer to confirm the quote and the day."
    return { ok: true, message: `${wasPlaced ? "Job moved." : "On the calendar."} ${crewLine}${next}` }
  } catch (e) {
    return fail(e)
  }
}

const ConfirmSchema = z.object({
  jobId: idSchema,
  payment_method: z.enum(PAYMENT_METHODS),
  crew_ids: z.array(z.string().uuid()).max(20),
  note: z.string().trim().max(500).optional(),
})
export type ConfirmBookingInput = z.infer<typeof ConfirmSchema>

/**
 * "Confirmed with the customer": you called, they said yes to the price and the day, and told you how
 * they'll pay once the job is done. Puts the chosen crew on the job, books it, accepts the quote
 * (unpaid), closes the call card and emails the customer a confirmation.
 */
export async function confirmBooking(input: ConfirmBookingInput): Promise<ActionResult> {
  const session = await requireOwner()
  const parsed = ConfirmSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => i.message).join("; ") }
  try {
    const db = requireSupabaseAdmin()
    const res = await bookJob(db, parsed.data.jobId, {
      paymentMethod: parsed.data.payment_method,
      crewIds: parsed.data.crew_ids,
      actor: actorOf(session),
      siteUrl: siteUrl(),
      note: parsed.data.note ?? null,
    })
    revalidate()
    revalidatePath(`/admin/quotes/${res.job.quote_id ?? ""}`)
    const who = parsed.data.crew_ids.length ? `${parsed.data.crew_ids.length} crew on it` : "just you on it"
    return {
      ok: true,
      message: `Booked, ${who}. ${res.confirmationSent ? "Confirmation emailed to the customer." : "No confirmation went out (no email on file)."} Payment is collected after the job.`,
    }
  } catch (e) {
    return fail(e)
  }
}

/** Take a placed job back onto the rail (the customer wants a different day, or you do). */
export async function unplaceJob(jobId: string): Promise<ActionResult> {
  const session = await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  try {
    const db = requireSupabaseAdmin()
    const actor = actorOf(session)
    await unplaceJobCore(db, jobId, { actor })
    await retireLegacyBookingApprovals(db, jobId, actor, "Taken off the calendar.")
    revalidate()
    return { ok: true, message: "Back on the rail. Crew offers withdrawn; drag it onto another day when you're ready." }
  } catch (e) {
    return fail(e)
  }
}

/** Email the crew who haven't answered the availability request again. */
export async function remindCrew(jobId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  try {
    const n = await askCrewAgain(requireSupabaseAdmin(), jobId, { siteUrl: siteUrl() })
    revalidate()
    return { ok: true, message: n ? `Asked again: ${n} email${n === 1 ? "" : "s"} sent.` : "Nobody left to ask (everyone answered, or no email on file)." }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Toggle a weather hold. Setting it marks the job for re-planning (the scheduler takes it off its
 * day and keeps that day closed for it); clearing it reopens the day.
 */
export async function setWeatherHold(jobId: string, hold: boolean): Promise<ActionResult> {
  await requireOwner()
  const parsed = z.object({ jobId: idSchema, hold: z.boolean() }).safeParse({ jobId, hold })
  if (!parsed.success) return { ok: false, reason: "Invalid request." }
  try {
    const db = requireSupabaseAdmin()
    if (hold) {
      const held = await holdForWeather(db, [jobId])
      if (!held.length) return { ok: false, reason: "Only a job that hasn't started can be put on hold." }
    } else {
      await clearWeatherHold(db, jobId)
    }
    revalidate()
    return { ok: true, message: hold ? "Weather hold set. The job comes back to the rail for a new day." : "Weather hold cleared." }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Release an owner hold (set when you took a job off the calendar or marked a scheduler card handled):
 * the scheduler may place / cover the job again when it runs.
 */
export async function releaseJob(jobId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  try {
    const db = requireSupabaseAdmin()
    await setOwnerHold(db, jobId, false)
    revalidate()
    return { ok: true, message: "Released. The scheduler may suggest a slot for it." }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Cancel a job. An unpaid quote behind it is marked declined and its lead lost (the deal is off); a paid
 * one is left for the Refund button on the quote page.
 */
export async function cancelJob(jobId: string): Promise<ActionResult> {
  const session = await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  try {
    const db = requireSupabaseAdmin()
    const actor = actorOf(session)
    const job = await transitionJob(db, jobId, "cancelled", { actor })
    await retireLegacyBookingApprovals(db, jobId, actor, "Job cancelled.")
    await withdrawCallToConfirm(db, jobId, "rejected", { actor, note: "Job cancelled." })
    await clearQueuedReminder(db, jobId)
    let quoteNote = ""
    if (job.quote_id) {
      const quote = check(await db.from("quotes").select("*").eq("id", job.quote_id).maybeSingle(), "cancel(quote)")
      if (quote && !quote.paid_at && quote.status !== "declined") {
        check(await db.from("quotes").update({ status: "declined" }).eq("id", quote.id), "cancel(decline quote)")
        check(await db.from("leads").update({ status: "lost" }).eq("id", quote.lead_id), "cancel(lead)")
        quoteNote = " The quote is marked declined."
      } else if (quote?.paid_at) {
        quoteNote = " The quote is paid: refund it from the quote page if you need to."
      }
    }
    revalidate()
    return { ok: true, message: `Job cancelled.${quoteNote}` }
  } catch (e) {
    return fail(e)
  }
}

/** Ask the scheduler worker to suggest slots for everything on the rail now (de-duped per 15 minutes). */
export async function runScheduler(): Promise<ActionResult> {
  await requireOwner()
  try {
    await enqueueSchedule(requireSupabaseAdmin(), "owner_requested")
    revalidate()
    return { ok: true, message: "The scheduler will suggest slots shortly; each one asks the crew and raises a call card." }
  } catch (e) {
    return fail(e)
  }
}
