"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops/types"
import { addDays, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const Input = z.object({
  customerId: z.string().uuid(),
  /** What the message was about; becomes the price-log category. */
  about: z.string().trim().max(80),
  days: z.number().int().min(1).max(365),
})

/**
 * The follow-ups list is driven by the price log: "sent" writes an entry with a check-back date, "not
 * interested" writes one marked passed. Either way the customer's older due dates are cleared, since
 * this message is the follow-up they were waiting for.
 */
async function record(customerId: string, about: string, entry: { notes: string; follow_up_on: string | null; status: "open" | "passed" }, profileId: string) {
  const db = requireSupabaseAdmin()
  const today = localDate(new Date())
  check(
    await db.from("customer_interactions").update({ follow_up_on: null }).eq("customer_id", customerId).eq("status", "open").not("follow_up_on", "is", null),
    "follow-up(clear old dates)",
  )
  check(await db.from("customer_interactions").insert({ customer_id: customerId, category: about || "Follow-up", price: null, talked_on: today, ...entry }), "follow-up(log)")
  // Nobody talking to them yet: whoever sent this is. Never takes over someone else's.
  check(await db.from("customers").update({ communicator_id: profileId }).eq("id", customerId).is("communicator_id", null), "follow-up(claim)")
  revalidatePath("/admin/customers", "layout")
  return today
}

/** "I sent it": logs the message and sets when to check back. */
export async function markFollowUpSent(input: z.input<typeof Input>): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const v = Input.parse(input)
    const today = localDate(new Date())
    await record(v.customerId, v.about, { notes: "Follow-up message sent.", follow_up_on: addDays(today, v.days), status: "open" }, session.profile.id)
    return { ok: true, message: `Logged. Back on the list in ${v.days} day${v.days === 1 ? "" : "s"}.` }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** "Not interested": rests the customer for a season, then they come back with a new offer. */
export async function markFollowUpPassed(input: { customerId: string; about: string }): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const v = Input.omit({ days: true }).parse(input)
    await record(v.customerId, v.about, { notes: "Not interested for now.", follow_up_on: null, status: "passed" }, session.profile.id)
    return { ok: true, message: "Noted. They'll come back in about 3 months with a new offer." }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
