"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { loadMowRoutePlan } from "@/components/admin/mowing/load"
import { nextMonth } from "@/components/admin/snow/load"
import { requireOwner } from "@/lib/auth/session"
import { MOW_SETTINGS_ID, SNOW_PAY_METHODS, type SnowRouteStop } from "@/lib/db/types"
import { ensureCustomerLocation, locate } from "@/lib/geo/locate"
import { upsertCustomer } from "@/lib/ops/customers"
import { check, one } from "@/lib/ops/types"
import { zonedToUtc } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const Id = z.string().uuid()
const money = z.coerce.number().min(0).max(10_000)

function done(message: string): ActionResult {
  revalidatePath("/admin/mowing", "layout")
  revalidatePath("/admin/schedule")
  return { ok: true, message }
}

const PlanFields = z.object({
  frequency: z.enum(["weekly", "biweekly"]),
  price: money,
  est_minutes: z.coerce.number().int().min(1).max(480).nullable(),
  preferred_day: z.coerce.number().int().min(0).max(6).nullable(),
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first cut date."),
  notes: z.string().trim().max(500).nullable(),
})
export type MowPlanInput = z.input<typeof PlanFields>

/** Put a customer on a mowing schedule: someone on file, or a new customer. */
export async function addMowCustomer(
  who: { customer_id: string | null; name: string; phone: string; address: string },
  plan: MowPlanInput,
): Promise<ActionResult> {
  await requireOwner()
  try {
    const p = PlanFields.safeParse(plan)
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan." }
    const db = requireSupabaseAdmin()
    let customerId = who.customer_id ? Id.parse(who.customer_id) : null
    if (!customerId) {
      const name = who.name.trim().slice(0, 120)
      const address = who.address.trim().slice(0, 300)
      if (!name) return { ok: false, error: "Add a name." }
      if (!address) return { ok: false, error: "Add the address (the route needs it)." }
      customerId = (await upsertCustomer(db, { name, phone: who.phone.trim().slice(0, 40) || null, address })).id
    }
    const existing = check(await db.from("mow_customers").select("id").eq("customer_id", customerId).maybeSingle(), "mow(existing)")
    if (existing) return { ok: false, error: "They're already on a mowing schedule." }
    check(await db.from("mow_customers").insert({ customer_id: customerId, ...p.data, notes: p.data.notes || null }), "mow(add)")
    const located = await ensureCustomerLocation(db, customerId)
    return done(located ? "Added to mowing" : "Added, but the address couldn't be found on the map. Fix it on their page so they're in the route.")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function updateMowCustomer(id: string, plan: MowPlanInput & { active: boolean; address: string }): Promise<ActionResult> {
  await requireOwner()
  try {
    const mowId = Id.parse(id)
    const p = PlanFields.safeParse(plan)
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan." }
    const db = requireSupabaseAdmin()
    const row = one(await db.from("mow_customers").select("id,customer_id").eq("id", mowId).single(), "mow(row)")
    check(await db.from("mow_customers").update({ ...p.data, notes: p.data.notes || null, active: !!plan.active }).eq("id", mowId), "mow(update)")
    const address = plan.address.trim().slice(0, 300)
    const cust = one(await db.from("customers").select("id,address").eq("id", row.customer_id).single(), "mow(cust)")
    let note = ""
    if (address && address !== (cust.address ?? "")) {
      const hit = await locate(address)
      check(await db.from("customers").update({ address, lat: hit?.lat ?? null, lng: hit?.lng ?? null }).eq("id", row.customer_id), "mow(address)")
      if (!hit) note = " The new address couldn't be found on the map."
    }
    return done(`Saved.${note}`)
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function removeMowCustomer(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("mow_customers").delete().eq("id", Id.parse(id)), "mow(remove)")
    return done("Removed from mowing")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** The Cut button: log one mow now at their current price. */
export async function logCut(id: string): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const mc = one(await db.from("mow_customers").select("id,price").eq("id", Id.parse(id)).single(), "cut(row)")
    check(await db.from("mow_cuts").insert({ mow_customer_id: mc.id, price: Number(mc.price), logged_by: actorOf(session) }), "cut(insert)")
    return done("Cut logged")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function deleteCut(cutId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("mow_cuts").delete().eq("id", Id.parse(cutId)), "cut(delete)")
    return done("Cut removed")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

const SettingsSchema = z.object({
  default_price: money,
  default_minutes: z.coerce.number().int().min(1).max(480),
  drive_mph: z.coerce.number().min(1).max(80),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time."),
})

export async function saveMowSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  await requireOwner()
  try {
    const parsed = SettingsSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the numbers." }
    check(
      await requireSupabaseAdmin().from("mow_settings").upsert({ id: MOW_SETTINGS_ID, ...parsed.data, start_time: `${parsed.data.start_time}:00` }),
      "mow(settings)",
    )
    return done("Mowing settings saved")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Save a day's mowing route (replacing any saved for that date). It shows on the Jobs calendar. */
export async function saveMowRoute(date: string, trucks: number): Promise<ActionResult> {
  await requireOwner()
  try {
    const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date)
    const n = z.coerce.number().int().min(1).max(5).parse(trucks)
    const db = requireSupabaseAdmin()
    const { plan } = await loadMowRoutePlan(db, d, n)
    if (!plan.startAt || !plan.trucks.length) return { ok: false, error: "No lawns due that day with a map location." }
    const stops: SnowRouteStop[] = plan.trucks.flatMap((t) =>
      t.stops.map((s) => ({
        snow_customer_id: s.id,
        name: s.name,
        address: s.address,
        truck: t.truck,
        arrive_at: s.arriveAt.toISOString(),
        done_at: s.doneAt.toISOString(),
        minutes: s.minutes,
      })),
    )
    check(await db.from("mow_routes").delete().eq("run_date", d), "mow route(replace)")
    check(
      await db.from("mow_routes").insert({ run_date: d, start_at: plan.startAt.toISOString(), finish_at: plan.finishBy.toISOString(), trucks: plan.trucks.length, stops }),
      "mow route(save)",
    )
    return done("Route saved. It's on the Jobs calendar.")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function deleteMowRoute(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("mow_routes").delete().eq("id", Id.parse(id)), "mow route(delete)")
    return done("Route removed")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

const BillSchema = z.object({
  id: Id,
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "Bad month."),
  pay_method: z.enum(SNOW_PAY_METHODS as [string, ...string[]]).nullable().optional(),
  paid: z.boolean().optional(),
})

/** A customer's mowing bill for a month: how they pay and whether it's paid (paid freezes the amount). */
export async function setMowBill(input: { id: string; month: string; pay_method?: string | null; paid?: boolean }): Promise<ActionResult> {
  await requireOwner()
  try {
    const parsed = BillSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid bill." }
    const { id, month, pay_method, paid } = parsed.data
    const db = requireSupabaseAdmin()
    const mc = one(await db.from("mow_customers").select("*").eq("id", id).single(), "mow bill(customer)")
    const existing = check(await db.from("mow_bills").select("*").eq("mow_customer_id", id).eq("month", month).maybeSingle(), "mow bill(existing)")
    const from = zonedToUtc(month, "00:00").toISOString()
    const to = zonedToUtc(nextMonth(month), "00:00").toISOString()
    const cuts = check(await db.from("mow_cuts").select("price").eq("mow_customer_id", id).gte("cut_at", from).lt("cut_at", to), "mow bill(cuts)") ?? []
    const method = pay_method === undefined ? (existing?.pay_method ?? mc.pay_method ?? null) : pay_method
    const paidAt = paid === undefined ? (existing?.paid_at ?? null) : paid ? (existing?.paid_at ?? new Date().toISOString()) : null
    const frozen = existing?.paid_at && paidAt
    check(
      await db.from("mow_bills").upsert(
        {
          mow_customer_id: id,
          month,
          amount: frozen ? existing!.amount : cuts.reduce((a, c) => a + Number(c.price), 0),
          cuts: frozen ? existing!.cuts : cuts.length,
          pay_method: method as never,
          paid_at: paidAt,
        },
        { onConflict: "mow_customer_id,month" },
      ),
      "mow bill(save)",
    )
    if (pay_method) check(await db.from("mow_customers").update({ pay_method: pay_method as never }).eq("id", id), "mow bill(default method)")
    revalidatePath("/admin/mowing", "layout")
    return { ok: true, message: paid === undefined ? "Saved" : paid ? "Marked paid" : "Marked unpaid" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
