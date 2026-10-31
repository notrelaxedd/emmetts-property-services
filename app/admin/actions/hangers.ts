"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { normalizeHangerCode, randomHangerCode } from "@/lib/canvass/hangers"
import { updateCanvassSettings } from "@/lib/canvass/settings"
import { mostCommonGeoid } from "@/lib/canvass/streets"
import { check, one } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const streetSchema = z.string().trim().min(1, "Street is required").max(120, "Street name is too long")

const pitchSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, "Give the pitch a name").max(80, "Name is too long"),
  script: z.string().trim().max(2000, "Script is too long"),
  active: z.boolean(),
})

export type PitchInput = z.input<typeof pitchSchema>

const offerSchema = z.string().trim().max(240, "Keep the offer under 240 characters").nullable()

function revalidate() {
  revalidatePath("/admin/canvass/hangers")
  revalidatePath("/admin/canvass/insights")
}

/** How many random codes to try before giving up on a unique one (4 chars from a 31-letter alphabet: ~920k). */
const CODE_TRIES = 6

/**
 * Issue a QR code for a street's door hangers. The code's block group is the one most of the street's parcels sit
 * in. A street that already has an active code gets that code back rather than a second one.
 */
export async function createHangerCodeAction(street: string): Promise<{ ok: true; code: string; message: string } | { ok: false; reason: string }> {
  await requireOwner()
  const parsed = streetSchema.safeParse(street)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid street." }
  const name = parsed.data.toUpperCase()
  try {
    const db = requireSupabaseAdmin()
    const existing = check(
      await db.from("hanger_codes").select("code").eq("street", name).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      "find hanger code",
    )
    if (existing) return { ok: true, code: existing.code, message: `${name} already has code ${existing.code}.` }

    const parcels = check(await db.from("parcels").select("block_group_geoid").eq("street", name).limit(5000), "street parcels") ?? []
    const block_group_geoid = mostCommonGeoid(parcels)

    for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
      const code = randomHangerCode()
      const res = await db.from("hanger_codes").insert({ code, street: name, block_group_geoid, active: true }).select("code").single()
      if (res.error?.code === "23505") continue // code taken; roll again
      const row = one(res, "create hanger code")
      revalidate()
      return { ok: true, code: row.code, message: `Code ${row.code} created for ${name}.` }
    }
    return { ok: false, reason: "Couldn't find a free code. Try again." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Pause or resume a code. Paused codes still resolve (old hangers keep working) but are shown as inactive. */
export async function setHangerActiveAction(code: string, active: boolean): Promise<ActionResult> {
  await requireOwner()
  const normalized = normalizeHangerCode(code)
  if (!normalized) return { ok: false, reason: "Invalid code." }
  if (typeof active !== "boolean") return { ok: false, reason: "Invalid value." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("hanger_codes").update({ active }).eq("code", normalized).select("code"), "update hanger code")
    if (!rows?.length) return { ok: false, reason: "Code not found." }
    revalidate()
    return { ok: true, message: active ? `${normalized} is active.` : `${normalized} paused.` }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Add or edit a pitch (the script the crew picks at session start). New pitches go to the end of the list. */
export async function savePitchAction(input: PitchInput): Promise<ActionResult> {
  await requireOwner()
  const parsed = pitchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  const { id, ...v } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    if (id) {
      const rows = check(await db.from("pitches").update(v).eq("id", id).select("id"), "update pitch")
      if (!rows?.length) return { ok: false, reason: "Pitch not found." }
    } else {
      const last = check(await db.from("pitches").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle(), "pitch order")
      const sort_order = (last?.sort_order ?? 0) + 1
      check(await db.from("pitches").insert({ ...v, sort_order }), "add pitch")
    }
    revalidate()
    revalidatePath("/crew/walk")
    return { ok: true, message: id ? "Pitch saved." : "Pitch added." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** The season offer printed on hangers. Blank clears it, so the season default prints instead. */
export async function saveOfferTextAction(text: string | null): Promise<ActionResult> {
  await requireOwner()
  const parsed = offerSchema.safeParse(text)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid text." }
  const offer_text = parsed.data ? parsed.data : null
  try {
    const db = requireSupabaseAdmin()
    await updateCanvassSettings(db, { offer_text })
    revalidate()
    revalidatePath("/admin/canvass", "layout")
    return { ok: true, message: offer_text ? "Offer saved." : "Offer reset to the season default." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
