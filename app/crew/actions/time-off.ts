"use server"

import { z } from "zod"
import type { CrewException } from "@/lib/db/types"
import { createApproval, enqueueSchedule, getSettings } from "@/lib/ops"
import { addDays, formatDayLabel, localDate, zonedToUtc } from "@/lib/scheduler"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail, revalidateCrew, slotLabel, type ActionResult } from "./shared"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

const requestSchema = z
  .object({
    kind: z.enum(["off", "extra"]),
    date_from: date,
    date_to: date,
    start_time: time.nullable(),
    end_time: time.nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .refine((v) => v.date_to >= v.date_from, { message: "The end date is before the start date.", path: ["date_to"] })
  .refine((v) => (v.start_time === null) === (v.end_time === null), {
    message: "Give both a start and an end time, or neither.",
    path: ["end_time"],
  })
  .refine((v) => v.start_time === null || v.end_time === null || toMin(v.start_time) < toMin(v.end_time), {
    message: "The end time must be after the start time.",
    path: ["end_time"],
  })

export type TimeOffInput = z.input<typeof requestSchema>

/** "Oct 14" / "Oct 14–17" / "Oct 14 1:00–5:00pm" for titles. */
function rangeLabel(e: Pick<CrewException, "date_from" | "date_to" | "start_time" | "end_time">): string {
  const day = (d: string) => formatDayLabel(zonedToUtc(d, "12:00"))
  const days = e.date_from === e.date_to ? day(e.date_from) : `${day(e.date_from)} – ${day(e.date_to)}`
  if (!e.start_time || !e.end_time) return days
  return `${days}, ${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}`
}

/** Exception intervals as [start, end) epoch ms, one per day. */
function exceptionIntervals(e: Pick<CrewException, "date_from" | "date_to" | "start_time" | "end_time">) {
  const out: { start: number; end: number }[] = []
  for (let d = e.date_from; d <= e.date_to; d = addDays(d, 1)) {
    const start = zonedToUtc(d, e.start_time ?? "00:00").getTime()
    const end = e.end_time ? zonedToUtc(d, e.end_time).getTime() : zonedToUtc(addDays(d, 1), "00:00").getTime()
    out.push({ start, end })
  }
  return out
}

/**
 * Request time off or extra availability. Inserted as me (RLS; the guard trigger forces
 * `pending`), then decided with the service role:
 *  - `extra` → approved straight away;
 *  - `off` that overlaps one of my crew_confirmed / booked / in-progress jobs, or starts inside
 *    `drop_notice_hours` → stays pending + `crew_change` approval `{ crew_exception_id }`;
 *  - any other `off` → approved.
 * Either way the scheduler is asked to re-solve.
 */
export async function requestTimeOff(input: TimeOffInput): Promise<ActionResult> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.")
  const v = parsed.data
  const today = localDate(new Date())
  if (v.date_from < today) return fail("Pick today or a later date.")
  if (v.date_to > addDays(v.date_from, 90)) return fail("Keep a single request under 90 days.")

  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const { data: inserted, error } = await ctx.supabase
      .from("crew_exceptions")
      .insert({
        crew_id: ctx.me,
        kind: v.kind,
        date_from: v.date_from,
        date_to: v.date_to,
        start_time: v.start_time,
        end_time: v.end_time,
        note: v.note || null,
        status: "pending",
      })
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    const exc = inserted as CrewException

    const db = requireSupabaseAdmin()
    const approve = async () => {
      const { error: apErr } = await db.from("crew_exceptions").update({ status: "approved" }).eq("id", exc.id)
      if (apErr) throw new Error(apErr.message)
    }

    let message: string
    let jobIds: string[] = []
    if (v.kind === "extra") {
      await approve()
      message = "Extra availability added."
    } else {
      const settings = await getSettings(db)
      const intervals = exceptionIntervals(exc)
      const firstStart = intervals[0]?.start ?? Date.now()
      const insideNotice = firstStart - Date.now() < settings.drop_notice_hours * 3_600_000

      // My live assignments on jobs that are confirmed / booked / on, overlapping the time off.
      const { data: mine, error: aErr } = await db
        .from("job_assignments")
        .select("job_id")
        .eq("crew_id", ctx.me)
        .in("status", ["offered", "accepted", "swap_offered", "drop_requested"])
      if (aErr) throw new Error(aErr.message)
      const ids = Array.from(new Set((mine ?? []).map((a) => a.job_id)))
      const rangeStart = new Date(intervals[0].start).toISOString()
      const rangeEnd = new Date(intervals[intervals.length - 1].end).toISOString()
      const { data: jobs, error: jErr } = ids.length
        ? await db
            .from("crew_jobs")
            .select("id, status, start_at, end_at, customer_name")
            .in("id", ids)
            .lt("start_at", rangeEnd)
            .gt("end_at", rangeStart)
        : { data: [], error: null }
      if (jErr) throw new Error(jErr.message)
      const overlapping = (jobs ?? []).filter((j) => {
        if (!j.start_at || !j.end_at) return false
        const s = Date.parse(j.start_at)
        const e = Date.parse(j.end_at)
        return intervals.some((iv) => s < iv.end && e > iv.start)
      })
      jobIds = overlapping.map((j) => j.id)
      const firm = overlapping.filter((j) => ["crew_confirmed", "booked", "in_progress"].includes(j.status))

      if (firm.length || insideNotice) {
        const reasons: string[] = []
        if (firm.length) {
          reasons.push(
            `Overlaps ${firm.length} confirmed job${firm.length === 1 ? "" : "s"}: ${firm
              .map((j) => `${j.customer_name} ${slotLabel(j)}`)
              .join("; ")}`,
          )
        }
        if (insideNotice) reasons.push(`Starts inside the ${settings.drop_notice_hours} h notice window`)
        if (exc.note) reasons.push(`Note: ${exc.note}`)
        await createApproval(db, {
          kind: "crew_change",
          ref_table: "crew_exceptions",
          ref_id: exc.id,
          payload: { crew_exception_id: exc.id },
          title: `${ctx.session.profile.name || "Crew member"}: time off ${rangeLabel(exc)}`,
          summary: reasons.join(". ") + ".",
          created_by: "crew-app",
        })
        message = "Sent to the owner for an OK."
      } else {
        await approve()
        message = "Time off approved."
      }
    }

    try {
      await enqueueSchedule(db, v.kind === "extra" ? "crew_extra_availability" : "crew_time_off", jobIds)
    } catch (e) {
      console.error("[crew] enqueueSchedule failed", e)
    }
    revalidateCrew()
    return { ok: true, message }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** Cancel one of my pending / approved requests that hasn't finished yet. */
export async function cancelTimeOff(id: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(id)
  if (!parsed.success) return fail("That request isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const today = localDate(new Date())
    const { data: deleted, error } = await ctx.supabase
      .from("crew_exceptions")
      .delete()
      .eq("id", parsed.data)
      .eq("crew_id", ctx.me)
      .in("status", ["pending", "approved"])
      .gte("date_to", today)
      .select("id")
    if (error) throw new Error(error.message)
    if (!deleted || deleted.length === 0) return fail("That request can't be cancelled any more.")

    const db = requireSupabaseAdmin()
    // Withdraw the owner's pending card for it, if any.
    await db
      .from("approvals")
      .update({
        status: "rejected",
        decided_by: "crew-app",
        decided_at: new Date().toISOString(),
        decision_note: "Cancelled by the crew member.",
      })
      .eq("kind", "crew_change")
      .eq("ref_table", "crew_exceptions")
      .eq("ref_id", parsed.data)
      .eq("status", "pending")
    try {
      await enqueueSchedule(db, "crew_exception_cancelled")
    } catch (e) {
      console.error("[crew] enqueueSchedule failed", e)
    }
    revalidateCrew()
    return { ok: true, message: "Request cancelled." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}
