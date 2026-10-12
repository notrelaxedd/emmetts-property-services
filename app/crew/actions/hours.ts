"use server"

import { z } from "zod"
import type { Weekday } from "@/lib/db/types"
import { enqueueSchedule } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail, revalidateCrew, type ActionResult } from "./shared"

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM")
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

const blocksSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  blocks: z
    .array(z.object({ start_time: time, end_time: time }))
    .max(8)
    .refine((bs) => bs.every((b) => minutes(b.start_time) < minutes(b.end_time)), "Each block must end after it starts."),
})

/** Ask the scheduler to re-solve jobs that aren't booked yet. Never fails the save. */
async function nudgeScheduler() {
  try {
    await enqueueSchedule(requireSupabaseAdmin(), "crew_availability_changed")
  } catch (e) {
    console.error("[crew] enqueueSchedule failed", e)
  }
}

/** Replace my `crew_availability` blocks for one weekday (empty list = day off). */
export async function saveAvailability(input: {
  weekday: number
  blocks: { start_time: string; end_time: string }[]
}): Promise<ActionResult> {
  const parsed = blocksSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the times.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const { blocks } = parsed.data
    const weekday = parsed.data.weekday as Weekday
    const { error: delErr } = await ctx.supabase
      .from("crew_availability")
      .delete()
      .eq("crew_id", ctx.me)
      .eq("weekday", weekday)
    if (delErr) throw new Error(delErr.message)
    if (blocks.length) {
      const { error } = await ctx.supabase.from("crew_availability").insert(
        blocks.map((b) => ({
          crew_id: ctx.me,
          weekday,
          start_time: b.start_time,
          end_time: b.end_time,
        })),
      )
      if (error) throw new Error(error.message)
    }
    await nudgeScheduler()
    revalidateCrew()
    return { ok: true, message: "Saved" }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

export async function saveMaxHours(hours: number): Promise<ActionResult> {
  const parsed = z.number().min(0).max(80).safeParse(hours)
  if (!parsed.success) return fail("Pick between 0 and 80 hours.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const { error } = await ctx.supabase
      .from("profiles")
      .update({ max_hours_week: parsed.data })
      .eq("id", ctx.me)
      .eq("user_id", ctx.session.userId)
    if (error) throw new Error(error.message)
    await nudgeScheduler()
    revalidateCrew()
    return { ok: true, message: "Saved" }
  } catch (e) {
    return fail(errorMessage(e))
  }
}

export async function setPaused(paused: boolean): Promise<ActionResult> {
  const parsed = z.boolean().safeParse(paused)
  if (!parsed.success) return fail("Invalid value.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const { error } = await ctx.supabase
      .from("profiles")
      .update({ paused: parsed.data })
      .eq("id", ctx.me)
      .eq("user_id", ctx.session.userId)
    if (error) throw new Error(error.message)
    await nudgeScheduler()
    revalidateCrew()
    return { ok: true, message: parsed.data ? "Paused — no new jobs will be offered." : "Back on — new jobs can be offered." }
  } catch (e) {
    return fail(errorMessage(e))
  }
}
