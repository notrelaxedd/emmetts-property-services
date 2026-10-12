"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { EXPENSE_CATEGORIES } from "@/app/admin/money/math"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops"
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
