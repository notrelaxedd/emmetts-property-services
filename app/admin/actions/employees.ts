"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate(id?: string) {
  revalidatePath("/admin/employees")
  if (id) revalidatePath(`/admin/employees/${id}`)
  revalidatePath("/admin", "layout")
}

function siteOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  const h = headers()
  const origin = h.get("origin")
  if (origin) return origin
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`
  return "http://localhost:3000"
}

/** "(440) 555-0100" -> "+14405550100"; null if it doesn't look like a phone number. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "")
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return null
}

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  contact: z.string().trim().min(1, "Email or phone is required").max(120),
  rate: z.number().min(0).max(500).nullable(),
})

/**
 * Invite a crew member. Email → Supabase invite (magic link to /crew); phone → a confirmed phone
 * user who signs in with an SMS code. Then their profile is set to crew with the name and rate.
 * An existing profile keeps its role (so inviting yourself never demotes the owner).
 */
export async function inviteCrew(input: { name: string; contact: string; rate: number | null }): Promise<ActionResult> {
  await requireOwner()
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid invite." }
  const { name, contact, rate } = parsed.data
  const isEmail = contact.includes("@")
  const email = isEmail ? contact.toLowerCase() : null
  if (email && !z.email().safeParse(email).success) return { ok: false, reason: "That email doesn't look right." }
  const phone = isEmail ? null : toE164(contact)
  if (!isEmail && !phone) return { ok: false, reason: "Enter an email or a 10-digit phone number." }

  try {
    const admin = requireSupabaseAdmin()
    let userId: string | undefined
    if (email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        // Land new crew on the set-password page so they never depend on email links again.
        redirectTo: `${siteOrigin()}/api/auth/callback?next=${encodeURIComponent("/account/password?welcome=1")}`,
        data: { name },
      })
      if (error) return { ok: false, reason: error.message }
      userId = data.user?.id
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        phone: phone!,
        phone_confirm: true,
        user_metadata: { name },
      })
      if (error) return { ok: false, reason: error.message }
      userId = data.user?.id
    }
    if (!userId) return { ok: false, reason: "Supabase didn't return the new user." }

    const existing = check(await admin.from("profiles").select("id,role").eq("user_id", userId).maybeSingle(), "profile")
    const fields = {
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(rate !== null ? { hourly_rate: rate } : {}),
    }
    if (existing) {
      check(await admin.from("profiles").update(fields).eq("id", existing.id), "update profile")
    } else {
      check(
        await admin.from("profiles").upsert({ user_id: userId, role: "crew", ...fields }, { onConflict: "user_id" }),
        "create profile",
      )
    }
    revalidate()
    return {
      ok: true,
      message: email ? `Invite sent to ${email}.` : `${name} can now sign in at /login with a text code to ${phone}.`,
    }
  } catch (e) {
    return fail(e)
  }
}

const updateSchema = z.object({
  hourly_rate: z.number().min(0).max(500).optional(),
  max_hours_week: z.number().min(0).max(168).optional(),
  paused: z.boolean().optional(),
})

export async function updateEmployee(
  id: string,
  patch: { hourly_rate?: number; max_hours_week?: number; paused?: boolean },
): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid employee." }
  const parsed = updateSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  if (Object.keys(parsed.data).length === 0) return { ok: true, message: "Nothing to save." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("profiles").update(parsed.data).eq("id", id), "update employee")
    revalidate(id)
    return { ok: true, message: "Saved." }
  } catch (e) {
    return fail(e)
  }
}

export async function markPayoutPaid(payoutId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(payoutId).success) return { ok: false, reason: "Invalid payout." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("payouts")
        .update({ paid_cash_at: new Date().toISOString() })
        .eq("id", payoutId)
        .is("paid_cash_at", null)
        .select("crew_id"),
      "mark paid",
    )
    revalidate(rows?.[0]?.crew_id)
    revalidatePath("/admin/money")
    return { ok: true, message: rows?.length ? "Marked paid." : "Already paid." }
  } catch (e) {
    return fail(e)
  }
}

export async function markAllPaid(crewId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(crewId).success) return { ok: false, reason: "Invalid employee." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("payouts")
        .update({ paid_cash_at: new Date().toISOString() })
        .eq("crew_id", crewId)
        .is("paid_cash_at", null)
        .select("amount"),
      "mark all paid",
    )
    const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0)
    revalidate(crewId)
    revalidatePath("/admin/money")
    return { ok: true, message: rows?.length ? `Marked ${rows.length} payout${rows.length === 1 ? "" : "s"} paid ($${total.toFixed(2)}).` : "Nothing owed." }
  } catch (e) {
    return fail(e)
  }
}
