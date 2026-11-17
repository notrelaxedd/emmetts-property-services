"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { applyApprovedCrewException, check, decideApproval } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate() {
  revalidatePath("/admin/availability")
  revalidatePath("/admin/schedule")
  revalidatePath("/admin", "layout")
}

/**
 * Approve / decline a pending crew time-off or extra-day request. Any pending `crew_change`
 * approval for the same request is resolved to match, so the inbox doesn't ask twice. Approved time
 * off goes through the same path as the inbox's crew_change handler (`applyApprovedCrewException`):
 * the crew member comes off overlapping jobs, which keep their slots and get cover.
 */
export async function decideCrewException(id: string, decision: "approved" | "declined"): Promise<ActionResult> {
  const session = await requireOwner()
  const parsed = z.object({ id: idSchema, decision: z.enum(["approved", "declined"]) }).safeParse({ id, decision })
  if (!parsed.success) return { ok: false, reason: "Invalid request." }
  try {
    const db = requireSupabaseAdmin()
    const updated = check(
      await db.from("crew_exceptions").update({ status: decision }).eq("id", id).eq("status", "pending").select("*"),
      "update request",
    )
    if (!updated?.length) return { ok: false, reason: "That request was already handled." }

    const pending = check(
      await db.from("approvals").select("*").eq("kind", "crew_change").eq("status", "pending"),
      "crew_change approvals",
    ) ?? []
    const actor = session.profile.name || "owner"
    for (const a of pending) {
      if (a.ref_id === id || a.payload?.crew_exception_id === id) {
        await decideApproval(db, a.id, decision === "approved" ? "approved" : "rejected", {
          decidedBy: actor,
          note: `Decided on the Availability page.`,
        })
      }
    }

    if (decision === "approved") await applyApprovedCrewException(db, updated[0], { actor })
    revalidate()
    return { ok: true, message: decision === "approved" ? "Request approved. The scheduler will re-plan." : "Request declined." }
  } catch (e) {
    return fail(e)
  }
}
