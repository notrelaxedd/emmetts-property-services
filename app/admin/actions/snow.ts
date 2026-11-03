"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { loadRoutePlan, loadSnowSettings, nextMonth } from "@/components/admin/snow/load"
import { requireOwner } from "@/lib/auth/session"
import { SNOW_PAY_METHODS, SNOW_PLANS, SNOW_SETTINGS_ID, type SnowRouteStop } from "@/lib/db/types"
import { ensureCustomerLocation as ensureLocation, locate } from "@/lib/geo/locate"
import { upsertCustomer } from "@/lib/ops/customers"
import { check, one } from "@/lib/ops/types"
import { zonedToUtc } from "@/lib/scheduler/time"
import { monthCharge } from "@/lib/snow/billing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const Id = z.string().uuid()
const money = z.coerce.number().min(0).max(10_000)

function done(message: string): ActionResult {
  revalidatePath("/admin/snow", "layout")
  revalidatePath("/admin/schedule")
  return { ok: true, message }
}

const PlanFields = z
  .object({
    plan: z.enum(SNOW_PLANS as [string, ...string[]]),
    per_push_price: money.nullable(),
    est_minutes: z.coerce.number().int().min(1).max(240).nullable(),
    notes: z.string().trim().max(500).nullable(),
  })
  .refine((v) => v.plan !== "per_push" || v.per_push_price !== null, { message: "Set the price per push." })

const AddSchema = z.object({
  customer_id: Id.nullable(),
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(300),
})

export type SnowPlanInput = { plan: string; per_push_price: number | null; est_minutes: number | null; notes: string | null }

/** Put a customer on a snow plan: an existing customer, or a new one by name / phone / address. */
export async function addSnowCustomer(
  who: { customer_id: string | null; name: string; phone: string; address: string },
  plan: SnowPlanInput,
): Promise<ActionResult> {
  await requireOwner()
  try {
    const w = AddSchema.parse(who)
    const p = PlanFields.safeParse(plan)
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan." }
    const db = requireSupabaseAdmin()
    let customerId = w.customer_id
    if (!customerId) {
      if (!w.name) return { ok: false, error: "Add a name." }
      if (!w.address) return { ok: false, error: "Add the address (the route needs it)." }
      const c = await upsertCustomer(db, { name: w.name, phone: w.phone || null, address: w.address, snow_list: true })
      customerId = c.id
    } else {
      check(await db.from("customers").update({ snow_list: true }).eq("id", customerId), "snow(snow_list)")
    }
    const existing = check(await db.from("snow_customers").select("id").eq("customer_id", customerId).maybeSingle(), "snow(existing)")
    if (existing) return { ok: false, error: "They're already on a snow plan." }
    check(
      await db.from("snow_customers").insert({
        customer_id: customerId,
        plan: p.data.plan as SnowPlanInput["plan"] as never,
        per_push_price: p.data.plan === "per_push" ? p.data.per_push_price : null,
        est_minutes: p.data.est_minutes,
        notes: p.data.notes || null,
      }),
      "snow(add)",
    )
    const located = await ensureLocation(db, customerId)
    return done(located ? "Added to snow" : "Added, but the address couldn't be found on the map. Fix it on their page so they're in the route.")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Change a snow customer's plan, price, minutes, notes, address or active flag. */
export async function updateSnowCustomer(
  id: string,
  plan: SnowPlanInput & { active: boolean; address: string },
): Promise<ActionResult> {
  await requireOwner()
  try {
    const snowId = Id.parse(id)
    const p = PlanFields.safeParse(plan)
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan." }
    const db = requireSupabaseAdmin()
    const row = one(await db.from("snow_customers").select("id,customer_id").eq("id", snowId).single(), "snow(row)")
    check(
      await db
        .from("snow_customers")
        .update({
          plan: p.data.plan as never,
          per_push_price: p.data.plan === "per_push" ? p.data.per_push_price : null,
          est_minutes: p.data.est_minutes,
          notes: p.data.notes || null,
          active: !!plan.active,
        })
        .eq("id", snowId),
      "snow(update)",
    )
    const address = plan.address.trim().slice(0, 300)
    const cust = one(await db.from("customers").select("id,address").eq("id", row.customer_id).single(), "snow(cust)")
    let note = ""
    if (address && address !== (cust.address ?? "")) {
      const hit = await locate(address)
      check(await db.from("customers").update({ address, lat: hit?.lat ?? null, lng: hit?.lng ?? null }).eq("id", row.customer_id), "snow(address)")
      if (!hit) note = " The new address couldn't be found on the map."
    }
    return done(`Saved.${note}`)
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Take a customer off snow (their push log goes too). The customer stays in the customer log. */
export async function removeSnowCustomer(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("snow_customers").delete().eq("id", Id.parse(id)), "snow(remove)")
    return done("Removed from snow")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** The Push button: log one plow visit now. */
export async function logPush(id: string): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const sc = one(await db.from("snow_customers").select("id,plan,per_push_price").eq("id", Id.parse(id)).single(), "push(row)")
    let price: number | null = null
    if (sc.plan === "per_push") {
      const s = one(await db.from("snow_settings").select("default_per_push").eq("id", SNOW_SETTINGS_ID).single(), "push(settings)")
      price = Number(sc.per_push_price ?? s.default_per_push)
    }
    check(await db.from("snow_pushes").insert({ snow_customer_id: sc.id, price, logged_by: actorOf(session) }), "push(insert)")
    return done("Push logged")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Remove one push from the log (pressed by mistake). */
export async function deletePush(pushId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("snow_pushes").delete().eq("id", Id.parse(pushId)), "push(delete)")
    return done("Push removed")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

const SettingsSchema = z.object({
  low_price: money,
  medium_price: money,
  high_price: money,
  low_pushes: z.coerce.number().int().min(0).max(100).nullable(),
  medium_pushes: z.coerce.number().int().min(0).max(100).nullable(),
  high_pushes: z.coerce.number().int().min(0).max(100).nullable(),
  default_per_push: money,
  finish_by: z.string().regex(/^\d{2}:\d{2}$/, "Pick a finish time."),
  default_minutes: z.coerce.number().int().min(1).max(240),
  drive_mph: z.coerce.number().min(1).max(80),
  trigger_inches: z.coerce.number().min(0).max(24),
})

export async function saveSnowSettings(input: z.input<typeof SettingsSchema>): Promise<ActionResult> {
  await requireOwner()
  try {
    const parsed = SettingsSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the numbers." }
    check(
      await requireSupabaseAdmin().from("snow_settings").upsert({ id: SNOW_SETTINGS_ID, ...parsed.data, finish_by: `${parsed.data.finish_by}:00` }),
      "snow(settings)",
    )
    return done("Snow settings saved")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/** Save a morning's route (replacing any saved for that date). It shows on the Jobs calendar. */
export async function saveSnowRoute(date: string, trucks: number): Promise<ActionResult> {
  await requireOwner()
  try {
    const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date)
    const n = z.coerce.number().int().min(1).max(5).parse(trucks)
    const db = requireSupabaseAdmin()
    const { plan } = await loadRoutePlan(db, d, n)
    if (!plan.startAt || !plan.trucks.length) return { ok: false, error: "No driveways with a map location to route." }
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
    check(await db.from("snow_routes").delete().eq("run_date", d), "route(replace)")
    check(
      await db.from("snow_routes").insert({
        run_date: d,
        start_at: plan.startAt.toISOString(),
        finish_at: plan.finishBy.toISOString(),
        trucks: plan.trucks.length,
        stops,
      }),
      "route(save)",
    )
    return done("Route saved. It's on the Jobs calendar.")
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function deleteSnowRoute(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    check(await requireSupabaseAdmin().from("snow_routes").delete().eq("id", Id.parse(id)), "route(delete)")
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

/**
 * A customer's bill for one month: how they're paying and whether it's paid. Saves what the month
 * comes to right now (pushes and amount); marking it paid freezes that amount. The pay method also
 * becomes their default for next month.
 */
export async function setSnowBill(input: { id: string; month: string; pay_method?: string | null; paid?: boolean }): Promise<ActionResult> {
  await requireOwner()
  try {
    const parsed = BillSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid bill." }
    const { id, month, pay_method, paid } = parsed.data
    const db = requireSupabaseAdmin()
    const sc = one(await db.from("snow_customers").select("*").eq("id", id).single(), "bill(customer)")
    const existing = check(await db.from("snow_bills").select("*").eq("snow_customer_id", id).eq("month", month).maybeSingle(), "bill(existing)")

    const from = zonedToUtc(month, "00:00").toISOString()
    const to = zonedToUtc(nextMonth(month), "00:00").toISOString()
    const pushes = check(await db.from("snow_pushes").select("price").eq("snow_customer_id", id).gte("pushed_at", from).lt("pushed_at", to), "bill(pushes)") ?? []
    const charge = monthCharge(sc, await loadSnowSettings(db), pushes)

    const method = pay_method === undefined ? (existing?.pay_method ?? sc.pay_method ?? null) : (pay_method as "cash" | "card" | "check" | null)
    const paidAt = paid === undefined ? (existing?.paid_at ?? null) : paid ? (existing?.paid_at ?? new Date().toISOString()) : null
    // A paid bill keeps the amount it was paid at; anything else tracks the pushes.
    const frozen = existing?.paid_at && paidAt
    check(
      await db.from("snow_bills").upsert(
        {
          snow_customer_id: id,
          month,
          amount: frozen ? existing!.amount : charge.amount,
          pushes: frozen ? existing!.pushes : pushes.length,
          pay_method: method as never,
          paid_at: paidAt,
        },
        { onConflict: "snow_customer_id,month" },
      ),
      "bill(save)",
    )
    if (pay_method !== undefined && pay_method !== null) {
      check(await db.from("snow_customers").update({ pay_method: pay_method as never }).eq("id", id), "bill(default method)")
    }
    revalidatePath("/admin/snow", "layout")
    return { ok: true, message: paid === undefined ? "Saved" : paid ? "Marked paid" : "Marked unpaid" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
