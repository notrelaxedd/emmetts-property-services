import "server-only"

import type { Customer, SnowCustomer, SnowPush, SnowSettings } from "@/lib/db/types"
import { SNOW_SETTINGS_ID } from "@/lib/db/types"
import { opsConfig } from "@/lib/config"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { localDate, zonedToUtc } from "@/lib/scheduler/time"
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
  over: number
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
      over: charge.over,
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
