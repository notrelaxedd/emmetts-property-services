"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { opsConfig } from "@/lib/config"
import { areaLight, toMapParcel, toParcelRow } from "@/lib/canvass/admin-rows"
import type { MapParcel, ParcelRow } from "@/lib/canvass/admin-rows"
import type { Light } from "@/lib/canvass/lights"
import { loadParcelViews, slotAt, stopsFromViews } from "@/lib/canvass/load"
import { planSession } from "@/lib/canvass/plan"
import type { PlanParcel } from "@/lib/canvass/plan"
import { inspectCountyLayer, pullParcels, refreshBlockGroupPriors } from "@/lib/canvass/pull"
import { tracedAreaSqft } from "@/lib/canvass/quote"
import { updateCanvassSettings } from "@/lib/canvass/settings"
import type { CanvassSettingsPatch } from "@/lib/canvass/settings"
import { runNightlySummary, yesterdayLocal } from "@/lib/canvass/summary"
import { PARCEL_FIELD_KEYS, SERVICE_KEYS, TIER_KEYS } from "@/lib/canvass/types"
import type { GeoFeatureCollection, GeoPolygon, ParcelFieldKey, ParcelFieldMap } from "@/lib/canvass/types"
import type { PlanView } from "@/lib/canvass/views"
import type { HomePattern } from "@/lib/db/types"
import { check } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const fail = (e: unknown): { ok: false; reason: string } => ({ ok: false, reason: e instanceof Error ? e.message : String(e) })

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM")

const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(positionSchema).min(4).max(5000)).min(1).max(20),
})
const geometrySchema = z.union([
  polygonSchema,
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(positionSchema).min(4).max(5000)).min(1)).min(1).max(50) }),
])
const featureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z
    .array(z.object({ type: z.literal("Feature"), geometry: geometrySchema, properties: z.record(z.string(), z.unknown()).nullable().optional() }))
    .max(50),
})

/** A drawn area larger than roughly 11 km on a side is almost certainly a mistake (and a very long county pull). */
const MAX_PULL_SPAN_DEG = 0.1

function polygonSpan(polygon: GeoPolygon): { lat: number; lng: number } {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const ring of polygon.coordinates) {
    for (const [lng, lat] of ring) {
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
      minLng = Math.min(minLng, lng)
      maxLng = Math.max(maxLng, lng)
    }
  }
  return { lat: maxLat - minLat, lng: maxLng - minLng }
}

/** Pull every residential parcel inside the drawn polygon from the county (plus block groups + ACS priors). */
export async function pullParcelsAction(
  polygon: GeoPolygon,
): Promise<({ ok: true; message: string } & Awaited<ReturnType<typeof pullParcels>>) | { ok: false; reason: string }> {
  await requireOwner()
  const parsed = polygonSchema.safeParse(polygon)
  if (!parsed.success) return { ok: false, reason: "Draw a closed area with at least three corners first." }
  const span = polygonSpan(parsed.data)
  if (span.lat > MAX_PULL_SPAN_DEG || span.lng > MAX_PULL_SPAN_DEG) {
    return { ok: false, reason: "That area is too large for one pull. Draw a few streets at a time." }
  }
  try {
    const db = requireSupabaseAdmin()
    const result = await pullParcels(db, parsed.data, { log: (msg) => console.log(msg) })
    revalidatePath("/admin/canvass")
    const message =
      `Pulled ${result.pulled} parcel(s): ${result.residential} residential, ${result.inserted} new, ${result.updated} refreshed, ` +
      `${result.blockGroupsAssigned} block group(s) assigned.`
    return { ok: true, message, ...result }
  } catch (e) {
    console.error("[canvass] pull failed:", e instanceof Error ? e.message : e)
    return fail(e)
  }
}

/** Settings → "Refresh from county": read the layer's real field names, log them, save the auto field map. */
export async function inspectCountyLayerAction(): Promise<
  { ok: true; message: string; fieldMap: ParcelFieldMap; missing: ParcelFieldKey[] } | { ok: false; reason: string }
> {
  await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const { fieldMap, missing, layerName, fields } = await inspectCountyLayer(db)
    revalidatePath("/admin/canvass/settings")
    const message =
      `Read ${fields.length} field(s) from "${layerName}". ` +
      (missing.length > 0 ? `No match yet for: ${missing.join(", ")}. Pick them below.` : "Every field mapped.")
    return { ok: true, message, fieldMap, missing }
  } catch (e) {
    console.error("[canvass] county layer inspect failed:", e instanceof Error ? e.message : e)
    return fail(e)
  }
}

const serviceEnum = z.enum(SERVICE_KEYS as [string, ...string[]])
const mappingSchema = z.object({
  field: z.string().trim().max(200).nullable(),
  source: z.enum(["auto", "manual", "missing"]),
  candidates: z.array(z.string().max(200)).max(500),
})
const fieldMapPatchSchema = z.object({
  ...Object.fromEntries(PARCEL_FIELD_KEYS.map((k) => [k, mappingSchema.optional()])),
  layer_fields: z.array(z.object({ name: z.string().max(200), type: z.string().max(100), alias: z.string().max(200) })).max(500).optional(),
  layer_name: z.string().max(200).optional(),
  fetched_at: z.string().max(40).optional(),
})

/** One price / minutes cell: a number, or null to clear it ("owner to fill in" / unknown). */
const tierCell = z.number().min(0).max(100000).nullable().optional()
const tierRow = z.object(Object.fromEntries(TIER_KEYS.map((t) => [t, tierCell])))
/** service → tier → cell; any service or tier may be left out (the merge keeps the stored cell). */
const tierTableSchema = z.object(Object.fromEntries(SERVICE_KEYS.map((k) => [k, tierRow.optional()])))
const tierBoundsSchema = z
  .object({
    small_max: z.number().positive().max(1_000_000).optional(),
    medium_max: z.number().positive().max(1_000_000).optional(),
    large_max: z.number().positive().max(1_000_000).optional(),
  })
  .refine(
    (b) =>
      (b.small_max === undefined || b.medium_max === undefined || b.small_max < b.medium_max) &&
      (b.medium_max === undefined || b.large_max === undefined || b.medium_max < b.large_max) &&
      (b.small_max === undefined || b.large_max === undefined || b.small_max < b.large_max),
    { message: "Lot size bounds must go up: small, then medium, then large." },
  )
const weight = z.number().min(0).max(10).optional()

const settingsPatchSchema = z.object({
  hardscape_pct: z.number().min(0).max(1).optional(),
  price_tiers: tierTableSchema.optional(),
  tier_minutes: tierTableSchema.optional(),
  tier_bounds: tierBoundsSchema.optional(),
  crew_size: z.number().int().min(1).max(50).optional(),
  pay_rate: z.number().min(0).max(1000).optional(),
  score_weights: z.object({ time: weight, lawn: weight, customer: weight, owner: weight }).optional(),
  walk_doors: z.number().int().min(1).max(200).optional(),
  value_tier_enabled: z.boolean().optional(),
  value_tier_max: z.number().min(1).max(1.1).optional(),
  doors_per_hour: z.number().int().min(1).max(200).optional(),
  neighbor_n: z.number().int().min(0).max(50).optional(),
  recency_days: z.number().int().min(0).max(365).optional(),
  daytime_not_in_lf_threshold: z.number().min(0).max(1).optional(),
  daytime_nonworking_parent_threshold: z.number().min(0).max(1).optional(),
  work_hours: z.number().min(0).max(24).optional(),
  learned_min_knocks: z.number().int().min(1).max(1000).optional(),
  season_map: z.record(z.string().regex(/^([1-9]|1[0-2])$/), serviceEnum).optional(),
  residential_land_use_prefixes: z.array(z.string().trim().min(1).max(10)).max(100).optional(),
  parcel_field_map: fieldMapPatchSchema.optional(),
  acs_vintage: z.string().regex(/^\d{4}$/, "ACS vintage is a year like 2023").optional(),
  offer_text: z.string().trim().max(500).nullable().optional(),
})

/** Save canvass settings (partial), then recompute every block group's prior with the new thresholds. */
export async function saveCanvassSettingsAction(patch: CanvassSettingsPatch): Promise<ActionResult> {
  await requireOwner()
  const parsed = settingsPatchSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  try {
    const db = requireSupabaseAdmin()
    const data = parsed.data as CanvassSettingsPatch
    if (data.offer_text !== undefined) data.offer_text = data.offer_text?.trim() ? data.offer_text.trim() : null
    await updateCanvassSettings(db, data)
    const priors = await refreshBlockGroupPriors(db)
    revalidatePath("/admin/canvass", "layout")
    return { ok: true, message: priors.updated > 0 ? `Settings saved. ${priors.updated} area window(s) recomputed.` : "Settings saved." }
  } catch (e) {
    return fail(e)
  }
}

const parcelPatchSchema = z.object({
  callback_window: z.string().trim().max(200).nullable().optional(),
  home_pattern: z.enum(["home_weekdays", "evenings_only", "weekends_only", "unknown"]).nullable().optional(),
  do_not_knock: z.boolean().optional(),
  do_not_knock_reason: z.string().trim().max(500).nullable().optional(),
})

/** Owner edits on the parcel page: what the homeowner said, the crew's home pattern, do-not-knock. */
export async function updateParcelAction(
  id: string,
  patch: { callback_window?: string | null; home_pattern?: HomePattern | null; do_not_knock?: boolean; do_not_knock_reason?: string | null },
): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid parcel." }
  const parsed = parcelPatchSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid values." }
  const data = { ...parsed.data }
  if (data.callback_window !== undefined && !data.callback_window) data.callback_window = null
  if (data.do_not_knock_reason !== undefined && !data.do_not_knock_reason) data.do_not_knock_reason = null
  if (Object.keys(data).length === 0) return { ok: true, message: "Nothing to save." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("parcels").update(data).eq("id", id).select("id"), "update parcel")
    if (!rows?.length) return { ok: false, reason: "Parcel not found." }
    revalidatePath(`/admin/canvass/parcels/${id}`)
    revalidatePath("/admin/canvass")
    return { ok: true, message: data.do_not_knock ? "Saved. This house is marked do not knock." : "Parcel saved." }
  } catch (e) {
    return fail(e)
  }
}

/** Save (or clear, with null) the traced lawn polygons; the traced area overrides the county estimate. */
export async function saveTurfTraceAction(
  id: string,
  trace: GeoFeatureCollection | null,
): Promise<{ ok: true; message: string; turf_sqft_traced: number | null } | { ok: false; reason: string }> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid parcel." }
  let turf_geom: GeoFeatureCollection | null = null
  let turf_sqft_traced: number | null = null
  if (trace !== null) {
    const parsed = featureCollectionSchema.safeParse(trace)
    if (!parsed.success) return { ok: false, reason: "Trace at least one closed lawn shape first." }
    turf_geom = parsed.data as GeoFeatureCollection
    if (turf_geom.features.length > 0) {
      turf_sqft_traced = tracedAreaSqft(turf_geom)
      if (!(turf_sqft_traced > 0)) return { ok: false, reason: "The traced shape has no area. Try again." }
    } else {
      turf_geom = null
    }
  }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(await db.from("parcels").update({ turf_geom, turf_sqft_traced }).eq("id", id).select("id"), "save turf trace")
    if (!rows?.length) return { ok: false, reason: "Parcel not found." }
    revalidatePath(`/admin/canvass/parcels/${id}`)
    revalidatePath("/admin/canvass")
    return {
      ok: true,
      message: turf_sqft_traced === null ? "Trace cleared. Using the county estimate." : `Traced ${Math.round(turf_sqft_traced).toLocaleString("en-US")} sqft of lawn.`,
      turf_sqft_traced,
    }
  } catch (e) {
    return fail(e)
  }
}

const planInputSchema = z
  .object({
    date: dateSchema,
    start: timeSchema,
    end: timeSchema,
    startLat: z.number().min(-90).max(90).nullable().optional(),
    startLng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((v) => v.end > v.start, { message: "The slot must end after it starts.", path: ["end"] })

/** "Plan my session": the best houses whose window overlaps the slot, in walking order. Nothing is saved. */
export async function planSessionAction(input: {
  date: string
  start: string
  end: string
  startLat?: number | null
  startLng?: number | null
}): Promise<{ ok: true; plan: PlanView } | { ok: false; reason: string }> {
  await requireOwner()
  const parsed = planInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid slot." }
  const { date, start, end } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    // The light (and so each house's points) is judged over the whole slot.
    const { parcels, settings } = await loadParcelViews(db, { limit: 5000, slot: slotAt(date, start, end) })
    const byId = new Map(parcels.map((p) => [p.id, p]))
    const planParcels: PlanParcel[] = parcels.map((p) => ({
      id: p.id,
      centroid: p.centroid_lat !== null && p.centroid_lng !== null ? [p.centroid_lng, p.centroid_lat] : null,
      score: p.simple.points,
      window: p.window.window,
      lastKnockAt: p.lastKnock?.knocked_at ?? null,
      do_not_knock: p.do_not_knock,
      street: p.street,
    }))
    const hasStart = typeof parsed.data.startLat === "number" && typeof parsed.data.startLng === "number"
    const startPoint: [number, number] = hasStart
      ? [parsed.data.startLng as number, parsed.data.startLat as number]
      : [opsConfig.defaultBase.lng, opsConfig.defaultBase.lat]
    const result = planSession({
      parcels: planParcels,
      slot: { date, start, end },
      settings: { doors_per_hour: settings.doors_per_hour, recency_days: settings.recency_days },
      startPoint,
    })
    const ordered = result.stops.map((s) => byId.get(s.id)).filter((p): p is NonNullable<typeof p> => !!p)
    const stops = stopsFromViews(ordered, startPoint)
    return {
      ok: true,
      plan: {
        stops,
        totalMeters: result.totalMeters,
        excluded: result.excluded,
        counts: { candidates: result.counts.candidates, taken: result.counts.taken },
        slot: { date, start, end },
      },
    }
  } catch (e) {
    return fail(e)
  }
}

const rankInputSchema = z.object({
  at: z.string().datetime({ offset: true, message: "Pick a valid date and time." }),
  limit: z.number().int().min(1).max(5000).optional(),
})

/**
 * Re-rank the Canvass home for a chosen moment (the slot picker): every parcel's light, simple score and label are
 * judged at `at` instead of now. Returns the slim table rows and map shapes (owner pages only: rows carry points and
 * profit), plus the area's majority light at that moment. The server page can equally read `?at=<ISO>` and call
 * `loadParcelViews(db, { slot: { at: new Date(at) } })` itself.
 */
export async function rankForSlotAction(input: {
  at: string
  limit?: number
}): Promise<{ ok: true; at: string; rows: ParcelRow[]; map: MapParcel[]; light: Light | null } | { ok: false; reason: string }> {
  await requireOwner()
  const parsed = rankInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid time." }
  try {
    const db = requireSupabaseAdmin()
    const at = new Date(parsed.data.at)
    const { parcels } = await loadParcelViews(db, { limit: parsed.data.limit, slot: { at } })
    const rows = parcels.map(toParcelRow)
    return {
      ok: true,
      at: at.toISOString(),
      rows,
      map: parcels.flatMap((v) => {
        const m = toMapParcel(v)
        return m ? [m] : []
      }),
      light: areaLight(rows),
    }
  } catch (e) {
    return fail(e)
  }
}

/** "Run now" on the summary card: (re)build the nightly summary for a date (default yesterday, Ohio time). */
export async function runNightlySummaryAction(forDate?: string): Promise<ActionResult> {
  await requireOwner()
  const date = forDate ?? yesterdayLocal()
  if (!dateSchema.safeParse(date).success) return { ok: false, reason: "Date must be YYYY-MM-DD." }
  try {
    const db = requireSupabaseAdmin()
    const result = await runNightlySummary(db, date, { worker: "owner" })
    revalidatePath("/admin/canvass")
    return {
      ok: true,
      message: result.usedModel ? `Summary for ${date} written from ${result.knocks} knock(s).` : `No knocks on ${date}; stored an empty summary.`,
    }
  } catch (e) {
    console.error("[canvass] summary failed:", e instanceof Error ? e.message : e)
    return fail(e)
  }
}

/** Owner cleanup after a bad pull: delete parcels (their knocks go with them). */
export async function deleteParcelsAction(ids: string[]): Promise<ActionResult> {
  await requireOwner()
  const parsed = z.array(idSchema).min(1).max(5000).safeParse(ids)
  if (!parsed.success) return { ok: false, reason: "Pick at least one parcel." }
  try {
    const db = requireSupabaseAdmin()
    for (let i = 0; i < parsed.data.length; i += 100) {
      check(await db.from("parcels").delete().in("id", parsed.data.slice(i, i + 100)), "delete parcels")
    }
    revalidatePath("/admin/canvass")
    return { ok: true, message: `Deleted ${parsed.data.length} parcel(s).` }
  } catch (e) {
    return fail(e)
  }
}
