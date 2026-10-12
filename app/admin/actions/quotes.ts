"use server"

// Registers the per-kind side effects before anything calls `applyApproval`.
import "@/lib/ops/handlers"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage, runApprovalSideEffect } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import type { QuoteItem, QuoteItemStatus } from "@/lib/db/types"
import { createApproval, decideApproval } from "@/lib/ops/approvals"
import { quoteApprovalInput } from "@/lib/ops/handlers/custom_item"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import { fee, moneyRound, priceQuote } from "@/lib/pricing"
import { refundQuote } from "@/lib/stripe/checkout"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const Id = z.string().uuid()
const LOCKED = new Set(["accepted", "declined"])

const ItemSchema = z.object({
  id: Id.optional(),
  service_id: Id.nullable(),
  description: z.string().trim().min(1, "Every line needs a description").max(250),
  is_custom: z.boolean(),
  crew_size: z.number().int().min(1).max(20),
  est_hours: z.number().min(0).max(200),
  /** Only used for fixed-price lines (custom, or status `priced`); others are priced from crew × hours × wage. */
  price: z.number().min(0).max(1_000_000).nullable(),
})

const SaveSchema = z.object({
  wage: z.number().min(0).max(500),
  margin: z.number().min(0).max(0.95),
  total_override: z.number().positive().max(1_000_000).nullable(),
  items: z.array(ItemSchema).max(50),
  property: z.object({
    lot_acres: z.number().min(0).max(1000).nullable(),
    tree_cover: z.enum(["none", "light", "medium", "heavy"]).nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
  }),
})

export type SaveQuoteInput = z.infer<typeof SaveSchema>

/** Status a line keeps / gets after an edit. Referred / declined custom lines are left alone. */
function nextStatus(prev: QuoteItemStatus | undefined, item: z.infer<typeof ItemSchema>): QuoteItemStatus {
  // A standard line the owner priced by hand stays fixed-price while it has a price.
  if (!item.is_custom) return prev === "priced" && item.price !== null && item.price > 0 ? "priced" : "auto"
  if (prev === "referred" || prev === "declined") return prev
  return item.price !== null && item.price > 0 ? "priced" : "needs_owner"
}

function revalidateQuote(quoteId: string) {
  revalidatePath(`/admin/quotes/${quoteId}`)
  revalidatePath("/admin", "layout")
}

/**
 * Saves the quote review: recomputes every number server-side with `priceQuote` (never trusts the
 * client's totals), writes the items (insert / update / delete) and the customer's property fields.
 */
export async function saveQuote(quoteId: string, input: SaveQuoteInput): Promise<ActionResult> {
  await requireOwner()
  try {
    const id = Id.parse(quoteId)
    const parsed = SaveSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") }
    const data = parsed.data
    const db = requireSupabaseAdmin()

    const quote = check(await db.from("quotes").select("*").eq("id", id).maybeSingle(), "saveQuote(quote)")
    if (!quote) return { ok: false, error: "Quote not found." }
    if (LOCKED.has(quote.status)) return { ok: false, error: `This quote is ${quote.status} and can't be edited.` }

    const existing = check(await db.from("quote_items").select("*").eq("quote_id", id), "saveQuote(items)") ?? []
    const byId = new Map(existing.map((i) => [i.id, i]))
    for (const item of data.items) {
      if (item.id && !byId.has(item.id)) return { ok: false, error: "A line item no longer exists; reload the page." }
    }

    const rows = data.items.map((item, sort_order) => ({
      ...item,
      sort_order,
      status: nextStatus(item.id ? byId.get(item.id)?.status : undefined, item),
    }))
    const settings = await getSettings(db)
    const totals = priceQuote(
      // Same convention as `quoteItemInputs` (lib/ops/handlers/custom_item.ts): `priced` lines keep their price.
      rows.map((r) => ({
        crew_size: r.crew_size,
        est_hours: r.est_hours,
        price: r.price,
        is_custom: r.is_custom || r.status === "priced",
        status: r.status,
      })),
      settings,
      { wage: data.wage, margin: data.margin },
    )
    const price_total = data.total_override !== null ? moneyRound(data.total_override) : totals.price_total
    const fee_total = fee(price_total, settings)

    // Items: delete removed, update kept, insert new.
    const keep = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))
    const removed = existing.filter((i) => !keep.has(i.id)).map((i) => i.id)
    if (removed.length) check(await db.from("quote_items").delete().in("id", removed), "saveQuote(delete items)")
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const fields: Partial<QuoteItem> = {
        description: r.description,
        service_id: r.service_id,
        is_custom: r.is_custom,
        crew_size: r.crew_size,
        est_hours: r.est_hours,
        price:
          r.status === "referred" || r.status === "declined"
            ? null
            : r.is_custom || r.status === "priced"
              ? r.price
              : totals.items[i].price,
        status: r.status,
        sort_order: r.sort_order,
      }
      if (r.id) {
        check(await db.from("quote_items").update(fields).eq("id", r.id), "saveQuote(update item)")
      } else {
        check(await db.from("quote_items").insert({ ...fields, quote_id: id, partner_note: null, ai_summary: null }), "saveQuote(insert item)")
      }
    }

    check(
      await db
        .from("quotes")
        .update({
          wage: data.wage,
          margin: data.margin,
          labor_total: totals.labor_total,
          price_total,
          fee_total,
          profit_total: moneyRound(price_total - totals.labor_total - fee_total),
        })
        .eq("id", id),
      "saveQuote(quote)",
    )
    check(await db.from("customers").update(data.property).eq("id", quote.customer_id), "saveQuote(property)")

    revalidateQuote(id)
    const notes = [
      totals.needs_owner ? "a custom item still needs your price" : null,
      data.total_override === null && totals.min_applied ? "the minimum job price applied" : null,
    ].filter(Boolean)
    return { ok: true, message: notes.length ? `Quote saved (${notes.join("; ")})` : "Quote saved" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/**
 * "Send via Stripe": creates (or refreshes) the quote's approval, approves it as the owner and runs
 * the quote handler, which builds the Checkout session and emails the link.
 */
export async function sendQuote(quoteId: string): Promise<ActionResult> {
  const session = await requireOwner()
  const actor = actorOf(session)
  try {
    const id = Id.parse(quoteId)
    const db = requireSupabaseAdmin()
    const quote = check(await db.from("quotes").select("*").eq("id", id).maybeSingle(), "sendQuote(quote)")
    if (!quote) return { ok: false, error: "Quote not found." }
    if (LOCKED.has(quote.status)) return { ok: false, error: `This quote is ${quote.status}.` }
    const [itemsRes, customerRes] = await Promise.all([
      db.from("quote_items").select("*").eq("quote_id", id).order("sort_order", { ascending: true }),
      db.from("customers").select("id,name,email").eq("id", quote.customer_id).maybeSingle(),
    ])
    const items = check(itemsRes, "sendQuote(items)") ?? []
    const customer = check(customerRes, "sendQuote(customer)")
    if (!customer?.email) return { ok: false, error: "The customer has no email address, so there's nowhere to send the link." }
    if (items.some((i) => i.status === "needs_owner")) {
      return { ok: false, error: "Price, refer or decline the custom item first." }
    }
    const billed = items.filter((i) => (i.status === "auto" || i.status === "priced") && (i.price ?? 0) > 0)
    if (!billed.length || !(quote.price_total > 0)) return { ok: false, error: "Nothing on this quote has a price yet." }

    const approval = await createApproval(db, quoteApprovalInput(quote, items, customer.name, actor))
    const decided = await decideApproval(db, approval.id, "approved", { decidedBy: actor, note: "Sent from the quote page" })
    const res = await runApprovalSideEffect(db, decided, actor)
    revalidateQuote(id)
    if (!res.ok) return { ok: false, error: `Approved, but sending failed: ${res.error}` }
    return { ok: true, message: `Payment link emailed to ${customer.email}` }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Owner refund for a paid quote (cancels the job; Stripe TEST MODE until the owner goes live). */
export async function refundQuoteAction(quoteId: string, reason: string): Promise<ActionResult> {
  await requireOwner()
  try {
    const id = Id.parse(quoteId)
    const why = z.string().trim().min(1, "Add a reason for the refund").max(450).parse(reason)
    const db = requireSupabaseAdmin()
    const quote = check(await db.from("quotes").select("status,stripe_payment_intent_id").eq("id", id).maybeSingle(), "refund(quote)")
    if (!quote) return { ok: false, error: "Quote not found." }
    if (quote.status !== "accepted" || !quote.stripe_payment_intent_id) {
      return { ok: false, error: "Only paid (accepted) quotes can be refunded." }
    }
    const res = await refundQuote(db, id, { reason: why })
    revalidateQuote(id)
    return { ok: true, message: res.jobCancelled ? "Refunded and the job was cancelled" : "Refunded" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
