"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { EXPENSE_CATEGORIES } from "@/app/admin/money/math"
import { actorOf } from "@/components/admin/inbox/server"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops"
import { recordManualJob, removeManualJob } from "@/lib/ops/manual-jobs"
import { PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().positive("Amount must be more than $0").max(100000),
  note: z.string().trim().max(300).nullable(),
})

export async function addExpense(input: {
  date: string
  category: string
  amount: number
  note: string | null
}): Promise<ActionResult> {
  await requireOwner()
  const parsed = expenseSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid expense." }
  try {
    const db = requireSupabaseAdmin()
    const x = parsed.data
    check(
      await db.from("expenses").insert({ date: x.date, category: x.category, amount: Math.round(x.amount * 100) / 100, note: x.note || null }),
      "add expense",
    )
    revalidatePath("/admin/money")
    return { ok: true, message: "Expense added." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, reason: "Invalid expense." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("expenses").delete().eq("id", id), "delete expense")
    revalidatePath("/admin/money")
    return { ok: true, message: "Expense deleted." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- Jobs recorded by hand (done and paid) ----------

const paidJobSchema = z.object({
  customerId: z.string().regex(/^[0-9a-f-]{36}$/i, "Pick a customer"),
  description: z.string().trim().min(1, "Say what the job was").max(250),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  price: z.number().positive("Price must be more than $0").max(1_000_000),
  paid: z.number().positive("What they paid must be more than $0").max(1_000_000),
  method: z.enum(PAYMENT_METHODS),
  labor: z.number().min(0, "Crew pay can't be negative").max(1_000_000),
})

export type PaidJobInput = z.input<typeof paidJobSchema>

function revalidatePaidJob(customerId: string) {
  revalidatePath("/admin/money")
  revalidatePath("/admin/customers")
  revalidatePath(`/admin/customers/${customerId}`)
}

/** "Add a paid job": a job that's already done and paid, straight onto the Money page (lib/ops/manual-jobs.ts). */
export async function recordPaidJob(input: PaidJobInput): Promise<ActionResult> {
  const session = await requireOwner()
  const parsed = paidJobSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid job." }
  if (parsed.data.date > localDate(new Date())) return { ok: false, reason: "The date can't be in the future." }
  try {
    const db = requireSupabaseAdmin()
    await recordManualJob(db, { ...parsed.data, recordedBy: actorOf(session) })
    revalidatePaidJob(parsed.data.customerId)
    return { ok: true, message: "Saved: paid and done." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Undo a job added by hand by mistake. */
export async function removePaidJob(quoteId: string): Promise<ActionResult> {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(quoteId)) return { ok: false, reason: "Invalid job." }
  try {
    const db = requireSupabaseAdmin()
    const { customerId } = await removeManualJob(db, quoteId)
    revalidatePaidJob(customerId)
    return { ok: true, message: "Job removed." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
