"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { loadCommissions } from "@/lib/commissions/load"
import { commissionFor, DEFAULT_COMMISSION_RATE } from "@/lib/commissions/stats"
import type { CommissionMethod } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const METHODS = ["cash", "venmo", "zelle", "check", "other"] as const satisfies readonly CommissionMethod[]

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

const money = (n: number) => `$${n.toFixed(2)}`

function revalidate(repId?: string) {
  revalidatePath("/admin/employees/sales")
  if (repId) revalidatePath(`/admin/employees/sales/${repId}`)
  revalidatePath("/admin/money")
}

const repSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Keep the name under 60 characters"),
  phone: z.string().trim().max(40).nullable(),
  /** Percent, e.g. 20. */
  ratePercent: z.number().min(0, "Rate can't be negative").max(100, "Rate can't be over 100%"),
})

/** Add a sales rep. They show up in the /door dropdown right away. */
export async function createSalesRep(input: { name: string; phone: string | null; ratePercent: number | null }): Promise<ActionResult> {
  await requireOwner()
  const parsed = repSchema.safeParse({ ...input, ratePercent: input.ratePercent ?? DEFAULT_COMMISSION_RATE * 100 })
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid sales rep." }
  const { name, phone, ratePercent } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    const row = check(
      await db.from("sales_reps").insert({ name, phone: phone || null, commission_rate: ratePercent / 100 }).select("id").single(),
      "add sales rep",
    )
    revalidate()
    revalidatePath("/door")
    return { ok: true, id: row?.id, message: `${name} added. They can pick their name on /door now.` }
  } catch (e) {
    return fail(e)
  }
}

/** Edit a rep. A new rate applies to jobs not paid yet; paid ones keep what was paid. */
export async function updateSalesRep(id: string, input: { name: string; phone: string | null; ratePercent: number }): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid sales rep." }
  const parsed = repSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid details." }
  const { name, phone, ratePercent } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db.from("sales_reps").update({ name, phone: phone || null, commission_rate: ratePercent / 100 }).eq("id", id).select("id"),
      "update sales rep",
    )
    if (!rows?.length) return { ok: false, reason: "Sales rep not found." }
    revalidate(id)
    revalidatePath("/door")
    return { ok: true, message: "Saved." }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Take a rep off the /door dropdown. With no leads and no payouts they're deleted outright;
 * otherwise hidden (removed_at) so their jobs and pay stay on record.
 */
export async function removeSalesRep(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid sales rep." }
  try {
    const db = requireSupabaseAdmin()
    const [leads, payouts] = await Promise.all([
      db.from("leads").select("id", { count: "exact", head: true }).eq("sales_rep_id", id),
      db.from("commission_payouts").select("id", { count: "exact", head: true }).eq("sales_rep_id", id),
    ])
    check(leads, "count leads")
    check(payouts, "count payouts")
    revalidatePath("/door")
    if (!leads.count && !payouts.count) {
      check(await db.from("sales_reps").delete().eq("id", id), "delete sales rep")
      revalidate()
      return { ok: true, message: "Deleted." }
    }
    check(await db.from("sales_reps").update({ removed_at: new Date().toISOString() }).eq("id", id), "remove sales rep")
    revalidate(id)
    return { ok: true, message: "Removed from /door. Their jobs and pay stay on record." }
  } catch (e) {
    return fail(e)
  }
}

export async function restoreSalesRep(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid sales rep." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("sales_reps").update({ removed_at: null }).eq("id", id), "restore sales rep")
    revalidate(id)
    revalidatePath("/door")
    return { ok: true, message: "Restored. They're back on /door." }
  } catch (e) {
    return fail(e)
  }
}

const payOptsSchema = z.object({
  method: z.enum(METHODS).default("cash"),
  note: z.string().trim().max(200).nullable().default(null),
  /** Pay before the job is done. */
  early: z.boolean().default(false),
})

/**
 * Mark one job's commission paid. The amount is worked out here from the job's current price and
 * the rep's rate, never taken from the browser.
 */
export async function payCommission(
  jobId: string,
  opts: { method?: CommissionMethod; note?: string | null; early?: boolean } = {},
): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(jobId).success) return { ok: false, reason: "Invalid job." }
  const parsed = payOptsSchema.safeParse(opts)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid payment." }
  const { method, note, early } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    const job = check(await db.from("jobs").select("id,status,quote_id,customer_id").eq("id", jobId).maybeSingle(), "job")
    if (!job || !job.quote_id) return { ok: false, reason: "Job not found." }
    if (job.status === "cancelled") return { ok: false, reason: "That job was cancelled, so there's no commission." }
    if (job.status !== "done" && !early) return { ok: false, reason: "That job isn't done yet." }
    const quote = check(await db.from("quotes").select("lead_id,price_total").eq("id", job.quote_id).maybeSingle(), "quote")
    if (!quote) return { ok: false, reason: "Quote not found." }
    const lead = check(await db.from("leads").select("sales_rep_id").eq("id", quote.lead_id).maybeSingle(), "lead")
    if (!lead?.sales_rep_id) return { ok: false, reason: "No sales rep on this job." }
    const rep = check(await db.from("sales_reps").select("id,name,commission_rate").eq("id", lead.sales_rep_id).maybeSingle(), "rep")
    if (!rep) return { ok: false, reason: "Sales rep not found." }
    const customer = check(await db.from("customers").select("name,address").eq("id", job.customer_id).maybeSingle(), "customer")

    const price = quote.price_total === null ? 0 : Number(quote.price_total)
    if (price <= 0) return { ok: false, reason: "This job has no price yet." }
    const rate = Number(rep.commission_rate)
    const amount = commissionFor(price, rate)
    const { error } = await db.from("commission_payouts").insert({
      sales_rep_id: rep.id,
      job_id: job.id,
      customer_label: customer ? [customer.name, customer.address].filter(Boolean).join(" · ") : "",
      rate,
      job_amount: price,
      amount,
      method,
      note: note || null,
    })
    if (error?.code === "23505") return { ok: true, message: "Already paid." }
    if (error) throw new Error(error.message)
    revalidate(rep.id)
    return { ok: true, message: `Paid ${rep.name} ${money(amount)}.` }
  } catch (e) {
    return fail(e)
  }
}

/** Undo a payout (marked paid by mistake). The job goes back to owed. */
export async function undoCommissionPayout(payoutId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(payoutId).success) return { ok: false, reason: "Invalid payout." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("commission_payouts").delete().eq("id", payoutId).select("sales_rep_id"), "undo payout")
    if (!rows?.length) return { ok: false, reason: "Already undone." }
    revalidate(rows[0].sales_rep_id)
    return { ok: true, message: "Undone. It's back to owed." }
  } catch (e) {
    return fail(e)
  }
}

/** Pay a rep for every finished job they haven't been paid for. */
export async function payAllOwed(repId: string, method: CommissionMethod = "cash"): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(repId).success) return { ok: false, reason: "Invalid sales rep." }
  if (!METHODS.includes(method)) return { ok: false, reason: "Invalid method." }
  try {
    const db = requireSupabaseAdmin()
    const { reps, rows } = await loadCommissions(db, repId)
    const rep = reps[0]
    if (!rep) return { ok: false, reason: "Sales rep not found." }
    const owed = rows.filter((r) => r.status === "owed" && r.jobId && r.price !== null)
    if (!owed.length) return { ok: true, message: "Nothing owed." }
    const rate = Number(rep.commission_rate)
    const inserted = check(
      await db
        .from("commission_payouts")
        .upsert(
          owed.map((r) => ({
            sales_rep_id: rep.id,
            job_id: r.jobId,
            customer_label: [r.customer, r.address].filter(Boolean).join(" · "),
            rate,
            job_amount: r.price ?? 0,
            amount: commissionFor(r.price, rate),
            method,
          })),
          { onConflict: "job_id", ignoreDuplicates: true },
        )
        .select("amount"),
      "pay all owed",
    )
    const total = (inserted ?? []).reduce((s, p) => s + Number(p.amount), 0)
    revalidate(rep.id)
    const n = inserted?.length ?? 0
    return { ok: true, message: n ? `Paid ${rep.name} ${money(total)} for ${n} job${n === 1 ? "" : "s"}.` : "Already paid." }
  } catch (e) {
    return fail(e)
  }
}
