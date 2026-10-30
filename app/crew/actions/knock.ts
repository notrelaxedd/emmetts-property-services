"use server"

import { z } from "zod"
import { createDoorLeadAndQuote } from "@/lib/canvass/door-booking"
import type { LogKnockInput } from "@/lib/canvass/knock-queue"
import { loadNearbyParcels, loadTodayPlan, searchParcels } from "@/lib/canvass/load"
import { currentSeasonFocus } from "@/lib/canvass/season"
import { getCanvassSettings } from "@/lib/canvass/settings"
import type { ServiceKey } from "@/lib/canvass/types"
import type { NearbyParcel, PlanStopView } from "@/lib/canvass/views"
import { fetchKnockWeather } from "@/lib/canvass/weather"
import type { HomePattern, Knock, KnockOutcome, Parcel, Pitch } from "@/lib/db/types"
import { check, one } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail } from "./shared"

const OUTCOMES = [
  "no_answer",
  "not_interested",
  "quote_given",
  "booked",
  "call_back",
  "no_soliciting",
  "do_not_return",
  "has_service",
] as const satisfies readonly KnockOutcome[]
const HOME_PATTERNS = ["home_weekdays", "evenings_only", "weekends_only", "unknown"] as const satisfies readonly HomePattern[]

/** Outcomes that mark the parcel do-not-knock for good. */
const DO_NOT_KNOCK_OUTCOMES: readonly KnockOutcome[] = ["no_soliciting", "do_not_return"]
const DO_NOT_KNOCK_REASON: Partial<Record<KnockOutcome, string>> = {
  no_soliciting: "No soliciting sign",
  do_not_return: "Asked us not to return",
}

// Kept in sync with OUTCOMES in components/crew/knock/outcome-grid.tsx ("use server" files export functions only).
const OUTCOME_LABEL: Record<KnockOutcome, string> = {
  no_answer: "No answer",
  not_interested: "Not interested",
  quote_given: "Quote given",
  booked: "Booked",
  call_back: "Call back",
  no_soliciting: "No soliciting sign",
  do_not_return: "Asked not to return",
  has_service: "Already has service",
}

const coord = (min: number, max: number) => z.number().finite().min(min).max(max)
const money = z.number().finite().min(0).max(100_000).nullable().optional()
const text = (max: number) => z.string().trim().max(max).nullable().optional()

const logSchema = z.object({
  client_id: z.string().uuid("Bad client id"),
  parcel_id: z.string().uuid("Pick a house first"),
  outcome: z.enum(OUTCOMES),
  knocked_at: z.string().datetime({ offset: true }),
  lat: coord(-90, 90).nullable(),
  lng: coord(-180, 180).nullable(),
  pitch_id: z.string().uuid().nullable(),
  quote_low: money,
  quote_high: money,
  callback_window: text(200),
  home_pattern: z.enum(HOME_PATTERNS).nullable().optional(),
  notes: text(2000),
})

const detailsSchema = z.object({
  callback_window: text(200),
  home_pattern: z.enum(HOME_PATTERNS).nullable().optional(),
  pitch_id: z.string().uuid().nullable().optional(),
  notes: text(2000),
  quote_low: money,
  quote_high: money,
})

export type KnockDetailsInput = z.input<typeof detailsSchema>

export type NearbyResult =
  | {
      ok: true
      parcels: NearbyParcel[]
      season: { service: ServiceKey; label: string; pitch: string }
      pitches: Pick<Pitch, "id" | "name" | "script">[]
      plan: { date: string; stops: PlanStopView[] } | null
    }
  | { ok: false; error: string }

/** Parcels within 250 m, the season focus, active pitches and today's saved plan (if any). */
export async function nearbyParcelsAction(lat: number, lng: number): Promise<NearbyResult> {
  const parsed = z.object({ lat: coord(-90, 90), lng: coord(-180, 180) }).safeParse({ lat, lng })
  if (!parsed.success) return fail("That location isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const db = requireSupabaseAdmin()
    const settings = await getCanvassSettings(db)
    const today = localDate(new Date())
    const [parcels, pitchRows, plan] = await Promise.all([
      loadNearbyParcels(db, parsed.data.lat, parsed.data.lng),
      db.from("pitches").select("id, name, script").eq("active", true).order("sort_order", { ascending: true }).order("name"),
      loadTodayPlan(db, today).catch((e) => {
        console.error("[knock] today's plan failed to load", e)
        return null
      }),
    ])
    const focus = currentSeasonFocus(settings.season_map)
    return {
      ok: true,
      parcels,
      season: { service: focus.service, label: focus.label, pitch: focus.pitch },
      pitches: (check(pitchRows, "nearby(pitches)") ?? []) as Pick<Pitch, "id" | "name" | "script">[],
      plan: plan ? { date: today, stops: plan.stops } : null,
    }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** Address search for when GPS is off or wrong. */
export async function searchParcelsAction(q: string): Promise<{ ok: true; parcels: NearbyParcel[] } | { ok: false; error: string }> {
  const parsed = z.string().trim().min(2, "Type a few letters of the address.").max(80).safeParse(q)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Type an address.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const db = requireSupabaseAdmin()
    return { ok: true, parcels: await searchParcels(db, parsed.data) }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

export type LogKnockResult = { ok: true; knock_id: string; message: string; do_not_knock: boolean } | { ok: false; error: string }

/**
 * One tap at the door. Idempotent on `client_id` (the offline queue re-sends). The insert comes
 * first; weather (3 s cap) runs alongside it, and the lead / quote for a booking follows.
 */
export async function logKnockAction(input: LogKnockInput): Promise<LogKnockResult> {
  const parsed = logSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the knock.")
  const v = parsed.data
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const db = requireSupabaseAdmin()
    const existing = check(
      await db.from("knocks").select("id, parcel_id").eq("client_id", v.client_id).maybeSingle(),
      "logKnock(existing)",
    )
    if (existing) {
      const p = check(await db.from("parcels").select("do_not_knock").eq("id", existing.parcel_id).maybeSingle(), "logKnock(parcel)")
      return { ok: true, knock_id: existing.id, message: `Logged: ${OUTCOME_LABEL[v.outcome]}`, do_not_knock: p?.do_not_knock ?? false }
    }

    const parcel = check(await db.from("parcels").select("*").eq("id", v.parcel_id).maybeSingle(), "logKnock(parcel)") as Parcel | null
    if (!parcel) return fail("That house isn't in the list any more.")

    // Weather runs while the insert goes through; never blocks for more than its 3 s cap.
    const weatherP = v.lat !== null && v.lng !== null ? fetchKnockWeather(v.lat, v.lng) : Promise.resolve(null)

    const knockedAt = new Date(v.knocked_at)
    const safeKnockedAt = Number.isFinite(knockedAt.getTime()) && knockedAt.getTime() <= Date.now() + 5 * 60_000 ? knockedAt : new Date()
    const inserted = await db
      .from("knocks")
      .insert({
        parcel_id: parcel.id,
        knocked_at: safeKnockedAt.toISOString(),
        knocker_id: ctx.me,
        outcome: v.outcome,
        pitch_id: v.pitch_id,
        lat: v.lat,
        lng: v.lng,
        weather: null,
        notes: v.notes || null,
        callback_window: v.callback_window || null,
        home_pattern: v.home_pattern ?? null,
        quote_low: v.quote_low ?? null,
        quote_high: v.quote_high ?? null,
        lead_id: null,
        quote_id: null,
        client_id: v.client_id,
      })
      .select("*")
      .single()
    let knock: Knock
    if (inserted.error && (inserted.error as { code?: string }).code === "23505") {
      // Lost the race with a retry of the same client_id: that one wins.
      knock = one(await db.from("knocks").select("*").eq("client_id", v.client_id).single(), "logKnock(after conflict)")
      return { ok: true, knock_id: knock.id, message: `Logged: ${OUTCOME_LABEL[v.outcome]}`, do_not_knock: parcel.do_not_knock }
    }
    knock = one(inserted, "logKnock(insert)")

    const parcelPatch: Partial<Parcel> = {}
    let doNotKnock = parcel.do_not_knock
    if (DO_NOT_KNOCK_OUTCOMES.includes(v.outcome)) {
      parcelPatch.do_not_knock = true
      parcelPatch.do_not_knock_reason = DO_NOT_KNOCK_REASON[v.outcome] ?? "Asked us not to knock"
      doNotKnock = true
    }
    if (v.callback_window) parcelPatch.callback_window = v.callback_window
    if (v.home_pattern) parcelPatch.home_pattern = v.home_pattern
    if (Object.keys(parcelPatch).length) {
      check(await db.from("parcels").update(parcelPatch).eq("id", parcel.id), "logKnock(parcel update)")
    }

    let message = `Logged: ${OUTCOME_LABEL[v.outcome]}`
    if (v.outcome === "booked" || v.outcome === "quote_given") {
      try {
        const settings = await getCanvassSettings(db)
        const season = currentSeasonFocus(settings.season_map)
        const low = v.quote_low ?? v.quote_high ?? 0
        const high = v.quote_high ?? v.quote_low ?? 0
        const booking = await createDoorLeadAndQuote(db, {
          parcel,
          knocker_name: ctx.session.profile.name || "Crew",
          outcome: v.outcome,
          amount_low: low,
          amount_high: high,
          service: season.service,
        })
        check(await db.from("knocks").update({ lead_id: booking.lead_id, quote_id: booking.quote_id }).eq("id", knock.id), "logKnock(link)")
        message = v.outcome === "booked" ? "Booked. The owner will schedule it." : "Quote logged and sent to the owner."
      } catch (e) {
        console.error("[knock] lead / quote failed", e)
        message = `${message} (lead not created: ${errorMessage(e)})`
      }
    }

    const weather = await weatherP
    if (weather) {
      const { error } = await db.from("knocks").update({ weather }).eq("id", knock.id)
      if (error) console.warn("[knock] weather update failed", error.message)
    }

    return { ok: true, knock_id: knock.id, message, do_not_knock: doNotKnock }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** The optional details after a tap. Only the knock's own knocker (or an owner) may edit. */
export async function updateKnockDetailsAction(
  knock_id: string,
  patch: KnockDetailsInput,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(knock_id)
  if (!id.success) return fail("That knock isn't valid.")
  const parsed = detailsSchema.safeParse(patch)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details.")
  const v = parsed.data
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const db = requireSupabaseAdmin()
    const knock = check(await db.from("knocks").select("*").eq("id", id.data).maybeSingle(), "knockDetails(knock)") as Knock | null
    if (!knock) return fail("That knock isn't saved yet. Try again in a moment.")
    if (knock.knocker_id !== ctx.me && ctx.session.profile.role !== "owner") return fail("That's another crew member's knock.")

    const update: Partial<Knock> = {}
    if (v.callback_window !== undefined) update.callback_window = v.callback_window || null
    if (v.home_pattern !== undefined) update.home_pattern = v.home_pattern
    if (v.pitch_id !== undefined) update.pitch_id = v.pitch_id
    if (v.notes !== undefined) update.notes = v.notes || null
    if (v.quote_low !== undefined) update.quote_low = v.quote_low
    if (v.quote_high !== undefined) update.quote_high = v.quote_high
    if (Object.keys(update).length) check(await db.from("knocks").update(update).eq("id", knock.id), "knockDetails(update)")

    const parcelPatch: Partial<Parcel> = {}
    if (v.callback_window) parcelPatch.callback_window = v.callback_window
    if (v.home_pattern) parcelPatch.home_pattern = v.home_pattern
    if (Object.keys(parcelPatch).length) check(await db.from("parcels").update(parcelPatch).eq("id", knock.parcel_id), "knockDetails(parcel)")

    return { ok: true, message: "Details saved." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}
