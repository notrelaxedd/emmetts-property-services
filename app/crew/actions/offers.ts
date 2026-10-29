"use server"

import "@/lib/ops/handlers"
import { z } from "zod"
import type { JobAssignment } from "@/lib/db/types"
import { maybeConfirmJob, recordCrewResponse } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail, revalidateCrew, siteUrl, type ActionResult, type CrewContext } from "./shared"

const respondSchema = z.object({
  assignmentId: z.string().uuid(),
  response: z.enum(["accepted", "declined"]),
})

/**
 * Accept / decline a job offer or a swap offer.
 *
 * Normal offer: an availability answer (see `recordCrewResponse`). Available / Can't can be changed
 * while the owner is still confirming the day with the customer. Enough yeses move a `proposed` job to
 * `crew_confirmed`; a "can't" on a short-handed job asks the scheduler for cover for the same slot.
 * The owner picks the crew when booking.
 *
 * Swap offer (`swap_offered`, row `crew_id = me` = the candidate, `swap_to_crew_id` = the crew
 * member handing the job over): first to accept wins — the original holder's row becomes `dropped`,
 * mine becomes `accepted`, and the other swap rows for that hand-over are deleted. Declining deletes
 * my row. Swap rows are written with the service role (the guard trigger only lets crew make
 * offered→accepted/declined and accepted→drop_requested through RLS) after checking the row is mine.
 */
export async function respondToOffer(assignmentId: string, response: "accepted" | "declined"): Promise<ActionResult> {
  const parsed = respondSchema.safeParse({ assignmentId, response })
  if (!parsed.success) return fail("That offer link isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")

  try {
    const { data: row, error } = await ctx.supabase
      .from("job_assignments")
      .select("*")
      .eq("id", parsed.data.assignmentId)
      .eq("crew_id", ctx.me)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const assignment = row as JobAssignment | null
    if (!assignment || assignment.crew_id !== ctx.me) return fail("That offer isn't yours or no longer exists.")

    if (assignment.status === "swap_offered") {
      return parsed.data.response === "accepted" ? await acceptSwap(ctx, assignment) : await declineSwap(ctx, assignment)
    }
    // Ownership was checked above (RLS read); the write uses the service role so an answer can be changed.
    const res = await recordCrewResponse(requireSupabaseAdmin(), assignment, parsed.data.response, { siteUrl: siteUrl(), actor: `crew:${ctx.me}` })
    revalidateCrew()
    if (!res.changed) {
      return res.jobStatus === "booked" || res.jobStatus === "in_progress"
        ? fail("This job is already confirmed. Use Drop or Swap on the job if you can't make it.")
        : fail("You've already answered this offer.")
    }
    if (parsed.data.response === "declined") return { ok: true, message: "Thanks for letting us know." }
    return { ok: true, message: res.confirmed ? "Thanks! Enough of the crew is free. You'll see it here once the owner confirms the day." : "Thanks! You'll see it here once the owner confirms the day." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

async function acceptSwap(ctx: CrewContext, mine: JobAssignment): Promise<ActionResult> {
  const fromCrewId = mine.swap_to_crew_id
  const db = requireSupabaseAdmin()
  if (!fromCrewId) {
    await db.from("job_assignments").delete().eq("id", mine.id).eq("status", "swap_offered")
    revalidateCrew()
    return fail("This swap is no longer available.")
  }

  // First to accept wins: only one request can flip the original holder's row from accepted.
  const now = new Date().toISOString()
  const { data: taken, error: takeErr } = await db
    .from("job_assignments")
    .update({ status: "dropped", responded_at: now })
    .eq("job_id", mine.job_id)
    .eq("crew_id", fromCrewId)
    .eq("status", "accepted")
    .select("id")
  if (takeErr) throw new Error(takeErr.message)
  if (!taken || taken.length === 0) {
    await db.from("job_assignments").delete().eq("id", mine.id).eq("status", "swap_offered")
    revalidateCrew()
    return fail("Someone else already took this job.")
  }

  // Service role: swap_offered → accepted isn't a crew-client transition (guard trigger).
  const { error: mineErr } = await db
    .from("job_assignments")
    .update({ status: "accepted", responded_at: now, swap_to_crew_id: null })
    .eq("id", mine.id)
    .eq("crew_id", ctx.me)
    .eq("status", "swap_offered")
  if (mineErr) {
    // Put the job back with its original holder rather than leave it with nobody.
    await db.from("job_assignments").update({ status: "accepted" }).in("id", taken.map((t) => t.id))
    throw new Error(mineErr.message)
  }

  // Withdraw the same hand-over from everyone else.
  const { error: delErr } = await db
    .from("job_assignments")
    .delete()
    .eq("job_id", mine.job_id)
    .eq("swap_to_crew_id", fromCrewId)
    .eq("status", "swap_offered")
    .neq("id", mine.id)
  if (delErr) throw new Error(delErr.message)

  // On a proposed job the hand-over may complete the crew.
  await maybeConfirmJob(db, mine.job_id, { siteUrl: siteUrl(), actor: "crew-app" })
  revalidateCrew()
  return { ok: true, message: "The job is yours." }
}

async function declineSwap(ctx: CrewContext, mine: JobAssignment): Promise<ActionResult> {
  const db = requireSupabaseAdmin()
  const { error } = await db
    .from("job_assignments")
    .delete()
    .eq("id", mine.id)
    .eq("crew_id", ctx.me)
    .eq("status", "swap_offered")
  if (error) throw new Error(error.message)
  // Swap rows never block confirmation, but re-check in case this was the last thing outstanding.
  await maybeConfirmJob(db, mine.job_id, { siteUrl: siteUrl(), actor: "crew-app" })
  revalidateCrew()
  return { ok: true, message: "No problem — we'll leave it with the others." }
}
