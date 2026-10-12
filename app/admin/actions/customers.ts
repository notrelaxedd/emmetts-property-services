"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")

const patchSchema = z.object({
  notes: z.string().max(5000).nullable(),
  email_opt_in: z.boolean(),
  sms_opt_in: z.boolean(),
  snow_list: z.boolean(),
  lot_acres: z.number().min(0).max(1000).nullable(),
  tree_cover: z.enum(["none", "light", "medium", "heavy"]).nullable(),
})

export type CustomerPatch = z.infer<typeof patchSchema>

/** Owner edits from the customer log (notes, opt-ins, snow list, lot size, tree cover). */
export async function updateCustomer(id: string, patch: CustomerPatch): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid customer." }
  const parsed = patchSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  try {
    const db = requireSupabaseAdmin()
    const data = { ...parsed.data, notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null }
    const rows = check(await db.from("customers").update(data).eq("id", id).select("id"), "update customer")
    if (!rows?.length) return { ok: false, reason: "Customer not found." }
    revalidatePath(`/admin/customers/${id}`)
    revalidatePath("/admin/customers")
    return { ok: true, message: "Customer saved." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
