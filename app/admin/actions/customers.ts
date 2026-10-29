"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { opsConfig } from "@/lib/config"
import type { Customer } from "@/lib/db/types"
import { geocode } from "@/lib/geo"
import { check, formatPhone, normalizePhone, upsertCustomer } from "@/lib/ops"
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

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((s) => s === "" || z.string().email().safeParse(s).success, "That email doesn't look right"),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(300),
  parcel_id: z.string().trim().max(80),
})

export type CustomerContact = z.input<typeof contactSchema>

/**
 * Owner edits to who the customer is and where they live. A changed address is re-geocoded
 * (when a geocoder is configured) so scheduling distances follow it; otherwise its old
 * coordinates are cleared rather than left pointing at the previous address.
 */
export async function updateCustomerContact(id: string, input: CustomerContact): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid customer." }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  const v = parsed.data
  const digits = normalizePhone(v.phone)
  if (v.phone && digits.length !== 10) return { ok: false, reason: "Enter a 10-digit phone number, or leave it blank." }
  try {
    const db = requireSupabaseAdmin()
    const current = check(await db.from("customers").select("address").eq("id", id).maybeSingle(), "load customer")
    if (!current) return { ok: false, reason: "Customer not found." }
    const address = v.address || null
    const data: Partial<Customer> = {
      name: v.name,
      email: v.email || null,
      phone: digits || null,
      address,
      parcel_id: v.parcel_id || null,
    }
    if (address !== current.address) {
      let coords: { lat: number; lng: number } | null = null
      if (address && opsConfig.geocoder !== "none") {
        try {
          coords = await Promise.race([geocode(address), new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
        } catch (e) {
          console.error("[customers] geocode failed:", e instanceof Error ? e.message : e)
        }
      }
      data.lat = coords?.lat ?? null
      data.lng = coords?.lng ?? null
    }
    check(await db.from("customers").update(data).eq("id", id), "update customer contact")
    revalidatePath(`/admin/customers/${id}`)
    revalidatePath("/admin/customers")
    return { ok: true, message: "Contact info saved." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Delete a customer and everything hanging off them (leads, quotes, jobs, messages, price log).
 * Jobs with crew payouts on record can't be removed, so neither can their customer.
 */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid customer." }
  try {
    const db = requireSupabaseAdmin()
    const res = await db.from("customers").delete().eq("id", id).select("id")
    if (res.error?.code === "23503") {
      return { ok: false, reason: "This customer has jobs with crew payouts on record, so they can't be deleted." }
    }
    const rows = check(res, "delete customer")
    if (!rows?.length) return { ok: false, reason: "Customer not found." }
    revalidatePath("/admin/customers")
    revalidatePath("/admin/customers/log")
    return { ok: true, message: "Customer deleted." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- Price log (customer_interactions) ----------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date")
const statusSchema = z.enum(["open", "booked", "passed"])

const interactionSchema = z.object({
  customerId: idSchema.nullable(),
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  category: z.string().trim().min(1, "Say what you talked about").max(80),
  price: z.number().min(0, "Price can't be negative").max(1_000_000, "That price looks too high").nullable(),
  notes: z.string().trim().max(2000).nullable(),
  talkedOn: dateSchema,
  followUpOn: dateSchema.nullable(),
})

export type InteractionInput = z.input<typeof interactionSchema>

function revalidateLog(customerId?: string) {
  revalidatePath("/admin/customers/log")
  revalidatePath("/admin/customers")
  if (customerId) revalidatePath(`/admin/customers/${customerId}`)
}

/**
 * Log a conversation: what it was about and the price given. With no `customerId`, the customer
 * is found by phone number (or created from the name + phone), so repeat callers stay one customer.
 */
export async function logInteraction(input: InteractionInput): Promise<ActionResult & { customerId?: string }> {
  await requireOwner()
  const parsed = interactionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid entry." }
  const v = parsed.data
  try {
    const db = requireSupabaseAdmin()
    let customerId = v.customerId
    if (!customerId) {
      if (!v.name) return { ok: false, reason: "Name is required." }
      if (normalizePhone(v.phone).length !== 10) return { ok: false, reason: "Enter a 10-digit phone number." }
      customerId = (await upsertCustomer(db, { name: v.name, phone: v.phone })).id
    }
    check(
      await db.from("customer_interactions").insert({
        customer_id: customerId,
        category: v.category,
        price: v.price,
        notes: v.notes || null,
        talked_on: v.talkedOn,
        follow_up_on: v.followUpOn,
      }),
      "log interaction",
    )
    revalidateLog(customerId)
    return { ok: true, customerId, message: "Saved to the price log." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Mark a price-log entry open / booked / passed. */
export async function setInteractionStatus(id: string, status: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid entry." }
  const s = statusSchema.safeParse(status)
  if (!s.success) return { ok: false, reason: "Invalid status." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("customer_interactions").update({ status: s.data }).eq("id", id).select("customer_id"), "update interaction")
    if (!rows?.length) return { ok: false, reason: "Entry not found." }
    revalidateLog(rows[0].customer_id)
    return { ok: true, message: "Updated." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Delete a price-log entry logged by mistake. */
export async function deleteInteraction(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid entry." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("customer_interactions").delete().eq("id", id).select("customer_id"), "delete interaction")
    if (!rows?.length) return { ok: false, reason: "Entry not found." }
    revalidateLog(rows[0].customer_id)
    return { ok: true, message: "Deleted." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export type PriceHistory = {
  customer: { id: string; name: string } | null
  entries: { id: string; talked_on: string; category: string; price: number | null; status: string }[]
}

/** What's already on file for a phone number, shown while logging so the same price gets quoted. */
export async function priceHistoryForPhone(phone: string): Promise<PriceHistory> {
  await requireOwner()
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return { customer: null, entries: [] }
  const db = requireSupabaseAdmin()
  const variants = [digits, formatPhone(digits), `1${digits}`, `+1${digits}`]
  const customer = check(
    await db.from("customers").select("id,name").in("phone", variants).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "price history (customer)",
  )
  if (!customer) return { customer: null, entries: [] }
  const entries = check(
    await db
      .from("customer_interactions")
      .select("id,talked_on,category,price,status")
      .eq("customer_id", customer.id)
      .order("talked_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
    "price history (entries)",
  )
  return {
    customer,
    entries: (entries ?? []).map((e) => ({ ...e, price: e.price === null ? null : Number(e.price) })),
  }
}
