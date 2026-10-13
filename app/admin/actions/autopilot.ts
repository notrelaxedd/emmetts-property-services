"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { updateSettings } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const flag = z.object({ enabled: z.boolean() })
const rulesSchema = z.object({
  ad: flag,
  quote: z.object({ enabled: z.boolean(), max_total: z.number().min(0).max(100000).nullable() }),
  custom_item: flag,
  booking: flag,
  followup: flag,
  crew_change: flag,
  drop: flag,
  weather_hold: flag,
})

export type AutopilotInput = z.infer<typeof rulesSchema>

function revalidate() {
  revalidatePath("/admin/autopilot")
  revalidatePath("/admin", "layout")
}

export async function saveAutopilot(rules: AutopilotInput): Promise<ActionResult> {
  await requireOwner()
  const parsed = rulesSchema.safeParse(rules)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid rules." }
  try {
    const quote = parsed.data.quote
    await updateSettings(requireSupabaseAdmin(), {
      autopilot: { ...parsed.data, quote: { enabled: quote.enabled, max_total: quote.max_total === null ? null : Math.round(quote.max_total * 100) / 100 } },
    })
    revalidate()
    const on = Object.values(parsed.data).filter((r) => r.enabled).length
    return { ok: true, message: on ? `Autopilot saved (${on} on).` : "Autopilot saved. Everything needs your OK." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

const money = z.number().min(0).max(100000)
const settingsSchema = z.object({
  default_wage: money,
  /** Fraction 0–0.95 (the form sends percent / 100). */
  margin: z.number().min(0).max(0.95),
  min_job_price: money.nullable(),
  card_fee_pct: z.number().min(0).max(0.2),
  card_fee_fixed: z.number().min(0).max(10),
  drop_notice_hours: z.number().int().min(0).max(24 * 14),
  quote_valid_days: z.number().int().min(1).max(365),
  invoice_days_until_due: z.number().int().min(1).max(365),
  ai_monthly_cap: money.nullable(),
  partner_tree_service_name: z.string().trim().max(120).nullable(),
  partner_tree_service_email: z.union([z.email(), z.literal("")]).nullable(),
  base_lat: z.number().min(-90).max(90).nullable(),
  base_lng: z.number().min(-180).max(180).nullable(),
})

export type BusinessSettingsInput = z.infer<typeof settingsSchema>

export async function saveBusinessSettings(input: BusinessSettingsInput): Promise<ActionResult> {
  await requireOwner()
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid settings." }
  }
  const s = parsed.data
  try {
    await updateSettings(requireSupabaseAdmin(), {
      ...s,
      partner_tree_service_name: s.partner_tree_service_name || null,
      partner_tree_service_email: s.partner_tree_service_email || null,
    })
    revalidate()
    revalidatePath("/admin/money")
    return { ok: true, message: "Business settings saved." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
