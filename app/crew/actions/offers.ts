"use server"

import "@/lib/ops/handlers"
import { z } from "zod"
import type { JobAssignment } from "@/lib/db/types"
import { maybeConfirmJob, requestResolve } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail, revalidateCrew, siteUrl, type ActionResult, type CrewContext } from "./shared"

const respondSchema = z.object({
  assignmentId: z.string().uuid(),
  response: z.enum(["accepted", "declined"]),
})

/**
 * Accept / decline a job offer or a swap offer.
 *
 * Normal offer (`offered`): updates my own row through RLS. Decline → the job is marked for cover
 * (`resolve_reason = 'declined'`) and the scheduler offers the slot to someone else.
 * Accept → when every live assignment on a `proposed` job is accepted (and there are enough of
 * them), the job moves to `crew_confirmed` and a `booking` approval `{ job_id }` is raised
 * (auto-approved + applied when the owner turned booking autopilot on). See `maybeConfirmJob`.
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
    if (assignment.status !== "offered") return fail("You've already answered this offer.")

    const now = new Date().toISOString()
    const { data: updated, error: upErr } = await ctx.supabase
      .from("job_assignments")
      .update({ status: parsed.data.response, responded_at: now })
      .eq("id", assignment.id)
      .eq("crew_id", ctx.me)
      .eq("status", "offered")
      .select("id")
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0) return fail("You've already answered this offer.")

    const db = requireSupabaseAdmin()
    if (parsed.data.response === "declined") {
      await requestResolve(db, [assignment.job_id], "declined", "offer_declined")
      revalidateCrew()
      return { ok: true, message: "Thanks — we'll find someone else." }
    }

    const confirmed = await maybeConfirmJob(db, assignment.job_id, { siteUrl: siteUrl(), actor: "crew-app" })
    revalidateCrew()
    return { ok: true, message: confirmed ? "You're on it. The whole crew is confirmed." : "You're on it." }
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
