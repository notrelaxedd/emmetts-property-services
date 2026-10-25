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

const addressSchema = z.string().trim().max(200, "That address is too long")

/** Address -> lat/lng for the map and the scheduler. Best effort: null when off, slow or not found. */
async function coordsFor(address: string): Promise<{ lat: number; lng: number } | null> {
  if (opsConfig.geocoder === "none") return null
  try {
    const hit = await Promise.race([geocode(address), new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
    return hit ? { lat: hit.lat, lng: hit.lng } : null
  } catch (e) {
    console.error("[customers] geocode failed:", e instanceof Error ? e.message : e)
    return null
  }
}

const patchSchema = z.object({
  address: addressSchema.nullable(),
  notes: z.string().max(5000).nullable(),
  email_opt_in: z.boolean(),
  sms_opt_in: z.boolean(),
  snow_list: z.boolean(),
  lot_acres: z.number().min(0).max(1000).nullable(),
  tree_cover: z.enum(["none", "light", "medium", "heavy"]).nullable(),
})

export type CustomerPatch = z.infer<typeof patchSchema>

/** Owner edits from the customer log (address, notes, opt-ins, snow list, lot size, tree cover). */
export async function updateCustomer(id: string, patch: CustomerPatch): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid customer." }
  const parsed = patchSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  try {
    const db = requireSupabaseAdmin()
    const current = check(await db.from("customers").select("address").eq("id", id).maybeSingle(), "load customer")
    if (!current) return { ok: false, reason: "Customer not found." }
    const address = parsed.data.address || null
    const data: Partial<Customer> = { ...parsed.data, address, notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null }
    // A new address moves the map pin; the old coordinates and parcel belong to the old address.
    if (address !== current.address) {
      const coords = address ? await coordsFor(address) : null
      data.lat = coords?.lat ?? null
      data.lng = coords?.lng ?? null
      data.parcel_id = null
    }
    const rows = check(await db.from("customers").update(data).eq("id", id).select("id"), "update customer")
    if (!rows?.length) return { ok: false, reason: "Customer not found." }
    revalidatePath(`/admin/customers/${id}`)
    revalidatePath("/admin/customers")
    return { ok: true, message: "Customer saved." }
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
  address: addressSchema,
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
    // Fill in the address when the customer doesn't have one yet; a different one is changed on their page.
    if (v.address) {
      const current = check(await db.from("customers").select("address").eq("id", customerId).maybeSingle(), "load customer")
      if (current && !current.address) {
        const coords = await coordsFor(v.address)
        check(
          await db
            .from("customers")
            .update({ address: v.address, lat: coords?.lat ?? null, lng: coords?.lng ?? null })
            .eq("id", customerId),
          "set address",
        )
      }
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
  customer: { id: string; name: string; address: string | null } | null
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
    await db.from("customers").select("id,name,address").in("phone", variants).order("created_at", { ascending: true }).limit(1).maybeSingle(),
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
