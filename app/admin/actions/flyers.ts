"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { DEFAULT_RATE_PER_FLYER, randomCode } from "@/lib/flyers/codes"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const rateSchema = z.number().min(0, "Rate can't be negative").max(100, "That rate looks too high")

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate(id?: string) {
  revalidatePath("/admin/employees/flyers")
  if (id) revalidatePath(`/admin/employees/flyers/${id}`)
  revalidatePath("/admin/money")
}

const workerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  phone: z.string().trim().max(40).nullable(),
  rate: rateSchema.nullable(),
})

/** Add a flyer worker. No sign-in: they get a code (their QR link) and nothing else. */
export async function createFlyerWorker(input: { name: string; phone: string | null; rate: number | null }): Promise<ActionResult> {
  await requireOwner()
  const parsed = workerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid flyer worker." }
  const { name, phone, rate } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    // Codes are random; on the rare clash with an existing one, draw again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode()
      const { data, error } = await db
        .from("flyer_workers")
        .insert({ name, phone: phone || null, code, rate_per_flyer: rate ?? DEFAULT_RATE_PER_FLYER })
        .select("id")
        .single()
      if (error?.code === "23505") continue
      if (error || !data) throw new Error(error?.message ?? "No row returned.")
      revalidate()
      return { ok: true, id: data.id, message: `${name} added with code ${code}.` }
    }
    return { ok: false, reason: "Couldn't pick a free code. Try again." }
  } catch (e) {
    return fail(e)
  }
}

/** Edit a flyer worker's name, phone or default pay per flyer (new batches only). */
export async function updateFlyerWorker(
  id: string,
  input: { name: string; phone: string | null; rate: number },
): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid flyer worker." }
  const parsed = workerSchema.extend({ rate: rateSchema }).safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid details." }
  const { name, phone, rate } = parsed.data
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db.from("flyer_workers").update({ name, phone: phone || null, rate_per_flyer: rate }).eq("id", id).select("id"),
      "update flyer worker",
    )
    if (!rows?.length) return { ok: false, reason: "Flyer worker not found." }
    revalidate(id)
    return { ok: true, message: "Saved." }
  } catch (e) {
    return fail(e)
  }
}

const batchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  count: z.number().int("Whole flyers only").min(1, "How many flyers?").max(100000),
  rate: rateSchema,
  area: z.string().trim().max(120).nullable(),
})

/** Log flyers handed out. Pay for the batch is count × rate (the rate defaults from the worker). */
export async function logFlyerBatch(
  workerId: string,
  input: { date: string; count: number; rate: number; area: string | null },
): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(workerId).success) return { ok: false, reason: "Invalid flyer worker." }
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid batch." }
  const { date, count, rate, area } = parsed.data
  if (date > localDate(new Date())) return { ok: false, reason: "That date is in the future." }
  try {
    const db = requireSupabaseAdmin()
    const row = check(
      await db
        .from("flyer_batches")
        .insert({ flyer_worker_id: workerId, handed_out_on: date, flyer_count: count, rate, area: area || null })
        .select("amount")
        .single(),
      "log batch",
    )
    revalidate(workerId)
    return { ok: true, message: `Logged ${count.toLocaleString()} flyers ($${Number(row?.amount ?? 0).toFixed(2)} owed).` }
  } catch (e) {
    return fail(e)
  }
}

/** Fix a mistake: an unpaid batch can be deleted (a paid one stays on record). */
export async function deleteFlyerBatch(batchId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(batchId).success) return { ok: false, reason: "Invalid batch." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db.from("flyer_batches").delete().eq("id", batchId).is("paid_at", null).select("flyer_worker_id"),
      "delete batch",
    )
    if (!rows?.length) return { ok: false, reason: "Already paid (or already gone): paid batches stay on record." }
    revalidate(rows[0].flyer_worker_id)
    return { ok: true, message: "Batch deleted." }
  } catch (e) {
    return fail(e)
  }
}

export async function markFlyerBatchPaid(batchId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(batchId).success) return { ok: false, reason: "Invalid batch." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("flyer_batches")
        .update({ paid_at: new Date().toISOString() })
        .eq("id", batchId)
        .is("paid_at", null)
        .select("flyer_worker_id"),
      "mark paid",
    )
    revalidate(rows?.[0]?.flyer_worker_id)
    return { ok: true, message: rows?.length ? "Marked paid." : "Already paid." }
  } catch (e) {
    return fail(e)
  }
}

export async function markAllFlyerBatchesPaid(workerId: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(workerId).success) return { ok: false, reason: "Invalid flyer worker." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("flyer_batches")
        .update({ paid_at: new Date().toISOString() })
        .eq("flyer_worker_id", workerId)
        .is("paid_at", null)
        .select("amount"),
      "mark all paid",
    )
    const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0)
    revalidate(workerId)
    return {
      ok: true,
      message: rows?.length ? `Marked ${rows.length} batch${rows.length === 1 ? "" : "es"} paid ($${total.toFixed(2)}).` : "Nothing owed.",
    }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Remove a flyer worker. With no batches and no leads they are deleted outright; otherwise they are
 * hidden (removed_at) so their pay and results stay on record. Their QR code keeps working either way
 * while it exists: flyers already on doors still bring people to the quote form.
 */
export async function removeFlyerWorker(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid flyer worker." }
  try {
    const db = requireSupabaseAdmin()
    const [batches, leads] = await Promise.all([
      db.from("flyer_batches").select("id", { count: "exact", head: true }).eq("flyer_worker_id", id),
      db.from("leads").select("id", { count: "exact", head: true }).eq("flyer_worker_id", id),
    ])
    check(batches, "count batches")
    check(leads, "count leads")
    if (!batches.count && !leads.count) {
      check(await db.from("flyer_workers").delete().eq("id", id), "delete flyer worker")
      revalidate()
      return { ok: true, message: "Deleted." }
    }
    check(await db.from("flyer_workers").update({ removed_at: new Date().toISOString() }).eq("id", id), "remove flyer worker")
    revalidate(id)
    return { ok: true, message: "Removed. Their history stays on record." }
  } catch (e) {
    return fail(e)
  }
}

export async function restoreFlyerWorker(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid flyer worker." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("flyer_workers").update({ removed_at: null }).eq("id", id), "restore flyer worker")
    revalidate(id)
    return { ok: true, message: "Restored." }
  } catch (e) {
    return fail(e)
  }
}

/** Credit a lead to a flyer worker by hand (they called and mentioned the code), or clear it. */
export async function setLeadFlyerWorker(leadId: string, workerId: string | null): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(leadId).success) return { ok: false, reason: "Invalid lead." }
  if (workerId !== null && !idSchema.safeParse(workerId).success) return { ok: false, reason: "Invalid flyer worker." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db.from("leads").update({ flyer_worker_id: workerId }).eq("id", leadId).select("id"),
      "set lead flyer worker",
    )
    if (!rows?.length) return { ok: false, reason: "Lead not found." }
    revalidatePath(`/admin/leads/${leadId}`)
    // The previous worker's page changes too, so refresh every flyer page.
    revalidatePath("/admin/employees/flyers", "layout")
    return { ok: true, message: workerId ? "Credited to flyer worker." : "Flyer credit cleared." }
  } catch (e) {
    return fail(e)
  }
}

export type StreetMark = { markId: string; streetId: string; coveredOn: string; workerId: string | null }
export type MarkResult = { ok: true; marks: StreetMark[] } | { ok: false; reason: string }

const markSchema = z.object({
  streetIds: z.array(idSchema).min(1, "Pick a street").max(500),
  workerId: idSchema.nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
})

/** Flyer map: mark streets as flyered on a date (and by whom, if known). */
export async function markStreets(input: { streetIds: string[]; workerId: string | null; date: string }): Promise<MarkResult> {
  await requireOwner()
  const parsed = markSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid streets." }
  const { streetIds, workerId, date } = parsed.data
  if (date > localDate(new Date())) return { ok: false, reason: "That date is in the future." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("flyer_street_marks")
        .insert(Array.from(new Set(streetIds)).map((street_id) => ({ street_id, flyer_worker_id: workerId, covered_on: date })))
        .select("id,street_id,covered_on,flyer_worker_id"),
      "mark streets",
    )
    return {
      ok: true,
      marks: (rows ?? []).map((m) => ({ markId: m.id, streetId: m.street_id, coveredOn: m.covered_on, workerId: m.flyer_worker_id })),
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Flyer map: take back marks (a mis-tap). Returns each affected street's newest remaining mark, so
 * the map can recolour it (a street with no marks left comes back with `last: null`).
 */
export async function undoStreetMarks(
  markIds: string[],
): Promise<{ ok: true; streets: { streetId: string; last: StreetMark | null }[] } | { ok: false; reason: string }> {
  await requireOwner()
  const parsed = z.array(idSchema).min(1).max(500).safeParse(markIds)
  if (!parsed.success) return { ok: false, reason: "Nothing to undo." }
  try {
    const db = requireSupabaseAdmin()
    const removed = check(await db.from("flyer_street_marks").delete().in("id", parsed.data).select("street_id"), "undo marks") ?? []
    const streetIds = Array.from(new Set(removed.map((r) => r.street_id)))
    const remaining = streetIds.length
      ? check(
          await db
            .from("flyer_street_marks")
            .select("id,street_id,covered_on,flyer_worker_id")
            .in("street_id", streetIds)
            .order("covered_on", { ascending: false })
            .order("created_at", { ascending: false }),
          "remaining marks",
        ) ?? []
      : []
    const newest = new Map<string, StreetMark>()
    for (const m of remaining) {
      if (!newest.has(m.street_id)) newest.set(m.street_id, { markId: m.id, streetId: m.street_id, coveredOn: m.covered_on, workerId: m.flyer_worker_id })
    }
    return { ok: true, streets: streetIds.map((streetId) => ({ streetId, last: newest.get(streetId) ?? null })) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
