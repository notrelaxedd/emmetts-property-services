import "server-only"

import type { Customer, SnowBill, SnowCustomer, SnowPayMethod, SnowPush, SnowSettings } from "@/lib/db/types"
import { SNOW_SETTINGS_ID } from "@/lib/db/types"
import { opsConfig } from "@/lib/config"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { addDays, localDate, zonedToUtc } from "@/lib/scheduler/time"
import { monthCharge, monthStart, seasonStart } from "@/lib/snow/billing"
import { planSnowRoute, type RoutePlan } from "@/lib/snow/route"

export const DEFAULT_SNOW_SETTINGS: SnowSettings = {
  id: SNOW_SETTINGS_ID,
  created_at: "",
  updated_at: "",
  low_price: 60,
  medium_price: 100,
  high_price: 150,
  low_pushes: null,
  medium_pushes: null,
  high_pushes: null,
  default_per_push: 35,
  finish_by: "06:30:00",
  default_minutes: 15,
  drive_mph: 20,
  trigger_inches: 2,
}

export type SnowRow = {
  sc: SnowCustomer
  customer: Pick<Customer, "id" | "name" | "address" | "phone" | "lat" | "lng">
  monthPushes: number
  seasonPushes: number
  lastPush: string | null
  monthCharge: number
}

export async function loadSnowSettings(db: Db): Promise<SnowSettings> {
  const row = check(await db.from("snow_settings").select("*").eq("id", SNOW_SETTINGS_ID).maybeSingle(), "snow settings")
  return row ? { ...DEFAULT_SNOW_SETTINGS, ...row } : DEFAULT_SNOW_SETTINGS
}

/** Every snow customer with this month's and this season's push counts. THROWS on a query error. */
export async function loadSnowRows(db: Db, now = new Date()): Promise<{ settings: SnowSettings; rows: SnowRow[] }> {
  const today = localDate(now)
  const season = zonedToUtc(seasonStart(today), "00:00").toISOString()
  const month = zonedToUtc(monthStart(today), "00:00").toISOString()
  const [settings, scs] = await Promise.all([
    loadSnowSettings(db),
    db.from("snow_customers").select("*").order("created_at"),
  ])
  const list = check(scs, "snow customers") ?? []
  if (!list.length) return { settings, rows: [] }
  const [customers, pushes] = await Promise.all([
    db.from("customers").select("id,name,address,phone,lat,lng").in("id", list.map((s) => s.customer_id)),
    db.from("snow_pushes").select("snow_customer_id,pushed_at,price").gte("pushed_at", season).order("pushed_at", { ascending: false }),
  ])
  const byId = new Map((check(customers, "snow(customers)") ?? []).map((c) => [c.id, c]))
  const pushRows = (check(pushes, "snow(pushes)") ?? []) as Pick<SnowPush, "snow_customer_id" | "pushed_at" | "price">[]
  const rows = list.map((sc): SnowRow => {
    const mine = pushRows.filter((p) => p.snow_customer_id === sc.id)
    const thisMonth = mine.filter((p) => p.pushed_at >= month)
    const charge = monthCharge(sc, settings, thisMonth)
    return {
      sc,
      customer: byId.get(sc.customer_id) ?? { id: sc.customer_id, name: "Customer", address: null, phone: null, lat: null, lng: null },
      monthPushes: thisMonth.length,
      seasonPushes: mine.length,
      lastPush: mine[0]?.pushed_at ?? null,
      monthCharge: charge.amount,
    }
  })
  rows.sort((a, b) => Number(b.sc.active) - Number(a.sc.active) || a.customer.name.localeCompare(b.customer.name))
  return { settings, rows }
}

/** The planned route for a morning: active snow customers, from the shop, done by the finish-by time. */
export async function loadRoutePlan(db: Db, date: string, trucks: number): Promise<{ plan: RoutePlan; settings: SnowSettings; rows: SnowRow[] }> {
  const [{ settings, rows }, ops] = await Promise.all([loadSnowRows(db), getSettings(db)])
  const base = { lat: ops.base_lat ?? opsConfig.defaultBase.lat, lng: ops.base_lng ?? opsConfig.defaultBase.lng }
  const finishBy = zonedToUtc(date, settings.finish_by.slice(0, 5))
  const plan = planSnowRoute({
    base,
    trucks,
    mph: Number(settings.drive_mph),
    finishBy,
    stops: rows
      .filter((r) => r.sc.active)
      .map((r) => ({
        id: r.sc.id,
        name: r.customer.name,
        address: r.customer.address,
        lat: r.customer.lat,
        lng: r.customer.lng,
        minutes: r.sc.est_minutes ?? settings.default_minutes,
      })),
  })
  return { plan, settings, rows }
}

export type BillRow = {
  sc: SnowCustomer
  name: string
  phone: string | null
  email: string | null
  pushes: number
  amount: number
  payMethod: SnowPayMethod | null
  paidAt: string | null
}

/** "YYYY-MM-01" of the month after. */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
}

export function prevMonth(month: string): string {
  return `${addDays(month, -1).slice(0, 7)}-01`
}

/**
 * Every customer's bill for one month ("YYYY-MM-01"): customers who were active, had a push, or have a
 * saved bill. A paid bill keeps the amount it was paid at; an unpaid one is worked out from the pushes.
 */
export async function loadSnowBills(db: Db, month: string): Promise<{ settings: SnowSettings; rows: BillRow[] }> {
  const from = zonedToUtc(month, "00:00").toISOString()
  const to = zonedToUtc(nextMonth(month), "00:00").toISOString()
  const [settings, scsRes, pushesRes, billsRes] = await Promise.all([
    loadSnowSettings(db),
    db.from("snow_customers").select("*"),
    db.from("snow_pushes").select("snow_customer_id,price").gte("pushed_at", from).lt("pushed_at", to),
    db.from("snow_bills").select("*").eq("month", month),
  ])
  const scs = check(scsRes, "bills(customers)") ?? []
  const pushes = (check(pushesRes, "bills(pushes)") ?? []) as Pick<SnowPush, "snow_customer_id" | "price">[]
  const bills = new Map(((check(billsRes, "bills(bills)") ?? []) as SnowBill[]).map((b) => [b.snow_customer_id, b]))
  const pushed = new Set(pushes.map((p) => p.snow_customer_id))
  const included = scs.filter((sc) => sc.active || pushed.has(sc.id) || bills.has(sc.id))
  type Who = { id: string; name: string; phone: string | null; email: string | null }
  const people = included.length
    ? new Map(((check(await db.from("customers").select("id,name,phone,email").in("id", included.map((s) => s.customer_id)), "bills(names)") ?? []) as Who[]).map((c) => [c.id, c]))
    : new Map<string, Who>()
  const rows = included.map((sc): BillRow => {
    const mine = pushes.filter((p) => p.snow_customer_id === sc.id)
    const live = monthCharge(sc, settings, mine)
    const bill = bills.get(sc.id)
    const paid = !!bill?.paid_at
    return {
      sc,
      name: people.get(sc.customer_id)?.name ?? "Customer",
      phone: people.get(sc.customer_id)?.phone ?? null,
      email: people.get(sc.customer_id)?.email ?? null,
      pushes: paid ? bill!.pushes : mine.length,
      amount: paid ? Number(bill!.amount) : live.amount,
      payMethod: bill?.pay_method ?? sc.pay_method ?? null,
      paidAt: bill?.paid_at ?? null,
    }
  })
  rows.sort((a, b) => Number(!!a.paidAt) - Number(!!b.paidAt) || a.name.localeCompare(b.name))
  return { settings, rows }
}
