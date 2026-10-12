"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireOwner } from "@/lib/auth/session"
import { applyApprovedCrewException, check, decideApproval, enqueueSchedule } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i, "Bad id")
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)")

function fail(e: unknown): ActionResult {
  return { ok: false, reason: e instanceof Error ? e.message : String(e) }
}

function revalidate() {
  revalidatePath("/admin/availability")
  revalidatePath("/admin/schedule")
  revalidatePath("/admin", "layout")
}

const blockSchema = z
  .object({ weekday: z.number().int().min(0).max(6), start_time: hhmm, end_time: hhmm })
  .refine((b) => b.end_time > b.start_time, { message: "Each block must end after it starts" })

/** Replace every owner window with `blocks`. Overlapping blocks on the same day are rejected. */
export async function saveOwnerWindows(
  blocks: { weekday: number; start_time: string; end_time: string }[],
): Promise<ActionResult> {
  await requireOwner()
  const parsed = z.array(blockSchema).max(70).safeParse(blocks)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid hours." }
  const rows = parsed.data
  for (let d = 0; d < 7; d++) {
    const day = rows.filter((b) => b.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time))
    for (let i = 1; i < day.length; i++) {
      if (day[i].start_time < day[i - 1].end_time) return { ok: false, reason: "Two blocks on the same day overlap." }
    }
  }
  try {
    const db = requireSupabaseAdmin()
    const old = check(await db.from("owner_windows").select("id"), "owner windows") ?? []
    // Insert first, then delete the old rows, so a failed insert never leaves you with no hours.
    if (rows.length) check(await db.from("owner_windows").insert(rows), "save owner windows")
    if (old.length) check(await db.from("owner_windows").delete().in("id", old.map((o) => o.id)), "remove old windows")
    await enqueueSchedule(db, "owner_windows_changed")
    revalidate()
    return { ok: true, message: "Open hours saved." }
  } catch (e) {
    return fail(e)
  }
}

const exceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    closed: z.boolean(),
    start_time: hhmm.nullable(),
    end_time: hhmm.nullable(),
    note: z.string().trim().max(300).nullable(),
  })
  .refine((x) => x.closed || (x.start_time && x.end_time && x.end_time > x.start_time), {
    message: "Custom hours need a start and an end time (end after start).",
  })

/** One-off day: closed, or custom hours that replace that day's windows. */
export async function addOwnerException(input: {
  date: string
  closed: boolean
  start_time: string | null
  end_time: string | null
  note: string | null
}): Promise<ActionResult> {
  await requireOwner()
  const parsed = exceptionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Invalid exception." }
  const x = parsed.data
  try {
    const db = requireSupabaseAdmin()
    check(
      await db.from("owner_exceptions").insert({
        date: x.date,
        closed: x.closed,
        start_time: x.closed ? null : x.start_time,
        end_time: x.closed ? null : x.end_time,
        note: x.note || null,
      }),
      "add exception",
    )
    await enqueueSchedule(db, "owner_exception_changed")
    revalidate()
    return { ok: true, message: x.closed ? `Closed on ${x.date}.` : `Custom hours on ${x.date} saved.` }
  } catch (e) {
    return fail(e)
  }
}

export async function deleteOwnerException(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "Invalid id." }
  try {
    const db = requireSupabaseAdmin()
    check(await db.from("owner_exceptions").delete().eq("id", id), "delete exception")
    await enqueueSchedule(db, "owner_exception_changed")
    revalidate()
    return { ok: true, message: "Exception removed." }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Approve / decline a pending crew time-off or extra-day request. Any pending `crew_change`
 * approval for the same request is resolved to match, so the inbox doesn't ask twice. Approved time
 * off goes through the same path as the inbox's crew_change handler (`applyApprovedCrewException`):
 * the crew member comes off overlapping jobs, which keep their slots and get cover.
 */
export async function decideCrewException(id: string, decision: "approved" | "declined"): Promise<ActionResult> {
  const session = await requireOwner()
  const parsed = z.object({ id: idSchema, decision: z.enum(["approved", "declined"]) }).safeParse({ id, decision })
  if (!parsed.success) return { ok: false, reason: "Invalid request." }
  try {
    const db = requireSupabaseAdmin()
    const updated = check(
      await db.from("crew_exceptions").update({ status: decision }).eq("id", id).eq("status", "pending").select("*"),
      "update request",
    )
    if (!updated?.length) return { ok: false, reason: "That request was already handled." }

    const pending = check(
      await db.from("approvals").select("*").eq("kind", "crew_change").eq("status", "pending"),
      "crew_change approvals",
    ) ?? []
    const actor = session.profile.name || "owner"
    for (const a of pending) {
      if (a.ref_id === id || a.payload?.crew_exception_id === id) {
        await decideApproval(db, a.id, decision === "approved" ? "approved" : "rejected", {
          decidedBy: actor,
          note: `Decided on the Availability page.`,
        })
      }
    }

    if (decision === "approved") await applyApprovedCrewException(db, updated[0], { actor })
    revalidate()
    return { ok: true, message: decision === "approved" ? "Request approved. The scheduler will re-plan." : "Request declined." }
  } catch (e) {
    return fail(e)
  }
}
