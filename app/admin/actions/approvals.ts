"use server"

// Registers the per-kind side effects before anything calls `applyApproval`.
import "@/lib/ops/handlers"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage, runApprovalSideEffect, siteUrl } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import type { Approval, ApprovalKind } from "@/lib/db/types"
import { applyRejection, decideApproval, type ApprovalDecision } from "@/lib/ops/approvals"
import { isInfoBookingPayload, setOwnerHold } from "@/lib/ops/jobs"
import { PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { fee, moneyRound } from "@/lib/pricing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

// ---------- Payload patch validation (server actions are public endpoints) ----------

const money = z.number().nonnegative().max(1_000_000)
const text = (max: number) => z.string().trim().max(max)

const PATCH_SCHEMAS: Record<ApprovalKind, z.ZodType<Record<string, unknown>>> = {
  quote: z.object({ price_total: money.positive() }).partial().strict(),
  custom_item: z.discriminatedUnion("action", [
    z
      .object({
        action: z.literal("price"),
        price: money.positive(),
        est_hours: z.number().positive().max(200),
        crew_size: z.number().int().min(1).max(20),
      })
      .strict(),
    z.object({ action: z.literal("refer"), partner_note: text(2000) }).strict(),
    z.object({ action: z.literal("decline") }).strict(),
  ]),
  ad: z.object({ headline: text(200).min(1), body: text(3000).min(1), cta: text(100) }).partial().strict(),
  followup: z.object({ subject: text(300).min(1), body: text(10000).min(1) }).partial().strict(),
  weather_hold: z.object({ job_ids: z.array(z.string().uuid()).min(1).max(200) }).partial().strict(),
  ai_cap: z.object({ new_cap: money.nullable() }).partial().strict(),
  // "Call to confirm": how the customer will pay once the job is done, and who goes.
  booking: z.object({ payment_method: z.enum(PAYMENT_METHODS), crew_ids: z.array(z.string().uuid()).max(20) }).partial().strict(),
  crew_change: z.object({}).strict(),
  drop: z.object({}).strict(),
}

const DecisionSchema = z.enum(["approved", "edited", "rejected"])

export type DecideOptions = { note?: string; payloadPatch?: Record<string, unknown> }

// ---------- Kind-specific steps around the decision ----------

/** A quote override (`price_total`) is written to the quote BEFORE its handler builds the Stripe link. */
async function applyQuoteTotal(db: Db, approval: Approval, priceTotal: number): Promise<void> {
  const quoteId = approval.ref_table === "quotes" ? approval.ref_id : String(approval.payload.quote_id ?? "")
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "decide(quote)")
  if (!quote) throw new Error("The quote for this approval no longer exists.")
  if (quote.paid_at) throw new Error("This quote is already paid; refund it instead of changing the total.")
  const settings = await getSettings(db)
  const price = moneyRound(priceTotal)
  const feeTotal = fee(price, settings)
  check(
    await db
      .from("quotes")
      .update({ price_total: price, fee_total: feeTotal, profit_total: moneyRound(price - quote.labor_total - feeTotal) })
      .eq("id", quoteId),
    "decide(quote total)",
  )
}

// ---------- Actions ----------

/**
 * Owner decision on a pending approval. Approved / edited approvals then run their side effect;
 * a side-effect failure keeps the decision, is written to `decision_note`, and comes back as `warning`.
 */
export async function decide(
  approvalId: string,
  decision: ApprovalDecision,
  opts: DecideOptions = {},
): Promise<ActionResult> {
  const session = await requireOwner()
  const actor = actorOf(session)
  try {
    const parsedDecision = DecisionSchema.parse(decision)
    const db = requireSupabaseAdmin()
    const current = check(await db.from("approvals").select("*").eq("id", approvalId).maybeSingle(), "decide(lookup)")
    if (!current) return { ok: false, error: "That approval no longer exists." }
    if (current.status !== "pending") return { ok: false, error: `Already ${current.status}.` }

    let payloadPatch: Record<string, unknown> | undefined
    if (opts.payloadPatch && Object.keys(opts.payloadPatch).length > 0) {
      const parsed = PATCH_SCHEMAS[current.kind].safeParse(opts.payloadPatch)
      if (!parsed.success) {
        return { ok: false, error: `Invalid edit: ${parsed.error.issues.map((i) => i.message).join("; ")}` }
      }
      payloadPatch = parsed.data
    }
    const note = opts.note?.trim() ? opts.note.trim().slice(0, 2000) : undefined

    if (parsedDecision !== "rejected" && current.kind === "quote" && typeof payloadPatch?.price_total === "number") {
      await applyQuoteTotal(db, current, payloadPatch.price_total)
    }

    const decided = await decideApproval(db, approvalId, parsedDecision, { decidedBy: actor, note, payloadPatch })

    let warning: string | undefined
    if (parsedDecision === "rejected") {
      // Undo provisional state (drop → crew stays on, quote → declined + lead lost, booking → back to
      // unscheduled + owner hold, followup → cancelled, ad → draft deleted, crew_change → declined).
      // The scheduler's informational cards ("Can't schedule X" / "No cover for X") are different:
      // "Mark handled" must not undo a hand-placed slot, it just tells the scheduler to leave the job
      // alone (owner hold) so the next sweep doesn't raise the same card again.
      const info = decided.kind === "booking" && isInfoBookingPayload(decided.payload)
      if (info) {
        const jobId = typeof decided.payload.job_id === "string" ? decided.payload.job_id : decided.ref_id
        try {
          await setOwnerHold(db, jobId, true)
        } catch (e) {
          warning = errorMessage(e)
        }
      } else {
        try {
          await applyRejection(db, decided, { siteUrl: siteUrl(), actor })
        } catch (e) {
          warning = errorMessage(e)
          const { error: noteError } = await db
            .from("approvals")
            .update({ decision_note: [decided.decision_note, `[reject step failed] ${warning}`].filter(Boolean).join("\n") })
            .eq("id", decided.id)
          if (noteError) console.error(`[admin] could not record the reject failure on ${decided.id}:`, noteError.message)
        }
      }
    } else {
      const res = await runApprovalSideEffect(db, decided, actor)
      if (!res.ok) warning = res.error
    }

    revalidatePath("/admin", "layout")
    const verb = parsedDecision === "rejected" ? "Rejected" : parsedDecision === "edited" ? "Approved with edits" : "Approved"
    return { ok: true, message: verb, ...(warning ? { warning } : {}) }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Re-runs the side effect of an approved / edited approval whose handler failed earlier. */
export async function retryApproval(approvalId: string): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const approval = check(await db.from("approvals").select("*").eq("id", approvalId).maybeSingle(), "retry(lookup)")
    if (!approval) return { ok: false, error: "That approval no longer exists." }
    if (approval.status !== "approved" && approval.status !== "edited") {
      return { ok: false, error: `Only approved items can be retried (this one is ${approval.status}).` }
    }
    const res = await runApprovalSideEffect(db, approval, actorOf(session))
    revalidatePath("/admin", "layout")
    return res.ok ? { ok: true, message: "Done" } : { ok: false, error: res.error }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
