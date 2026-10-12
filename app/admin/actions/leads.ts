"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import { enqueueTask } from "@/lib/ops/tasks"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const Id = z.string().uuid()

/** Asks the quotes worker to price this lead again (new quote + approval card). */
export async function rerunQuote(leadId: string): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const id = Id.parse(leadId)
    const db = requireSupabaseAdmin()
    const lead = check(await db.from("leads").select("id").eq("id", id).maybeSingle(), "rerunQuote(lead)")
    if (!lead) return { ok: false, error: "Lead not found." }
    // No dedupe key: the form's original task used `quote:<leadId>`, and a re-run must not be swallowed by it.
    await enqueueTask(db, { type: "quote", payload: { lead_id: id, rerun: true, requested_by: actorOf(session) } })
    revalidatePath(`/admin/leads/${id}`)
    revalidatePath("/admin/leads")
    return { ok: true, message: "Re-quote queued. A new card will land in the inbox." }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

const StatusSchema = z.enum(["spam", "lost", "new"])

/** Owner triage: mark a lead spam / lost, or restore it to new. */
export async function setLeadStatus(leadId: string, status: "spam" | "lost" | "new"): Promise<ActionResult> {
  await requireOwner()
  try {
    const id = Id.parse(leadId)
    const next = StatusSchema.parse(status)
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("leads").update({ status: next }).eq("id", id).select("id"), "setLeadStatus")
    if (!rows?.length) return { ok: false, error: "Lead not found." }
    revalidatePath(`/admin/leads/${id}`)
    revalidatePath("/admin/leads")
    return { ok: true, message: next === "new" ? "Restored" : `Marked ${next}` }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
