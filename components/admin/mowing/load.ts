import "server-only"

import { nextMonth } from "@/components/admin/snow/load"
import { opsConfig } from "@/lib/config"
import type { Customer, MowBill, MowCustomer, MowCut, MowSettings, SnowPayMethod } from "@/lib/db/types"
import { MOW_SETTINGS_ID } from "@/lib/db/types"
import { dueOnDate, dueThisWeek } from "@/lib/mowing/schedule"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { addDays, localDate, weekStart, zonedToUtc } from "@/lib/scheduler/time"
import { planSnowRoute, type RoutePlan } from "@/lib/snow/route"

export const DEFAULT_MOW_SETTINGS: MowSettings = {
  id: MOW_SETTINGS_ID,
  created_at: "",
  updated_at: "",
  default_price: 40,
  default_minutes: 30,
  drive_mph: 25,
  start_time: "08:00:00",
}

export async function loadMowSettings(db: Db): Promise<MowSettings> {
  const row = check(await db.from("mow_settings").select("*").eq("id", MOW_SETTINGS_ID).maybeSingle(), "mow settings")
  return row ? { ...DEFAULT_MOW_SETTINGS, ...row } : DEFAULT_MOW_SETTINGS
}

type Who = Pick<Customer, "id" | "name" | "address" | "phone" | "email" | "lat" | "lng">

export type MowRow = {
  mc: MowCustomer
  customer: Who
  monthCuts: number
  monthTotal: number
  seasonCuts: number
  lastCut: string | null
  /** Due in the week of `date` (weekly, or biweekly on-week). */
  dueWeek: boolean
  /** Already cut in the week of `date`. */
  cutWeek: boolean
}

/** Every mowing customer with this month's cuts and whether they're due / cut the week of `date`. THROWS on a query error. */
export async function loadMowRows(db: Db, date = localDate(new Date())): Promise<{ settings: MowSettings; rows: MowRow[] }> {
  const season = zonedToUtc(`${date.slice(0, 4)}-01-01`, "00:00").toISOString()
  const month = zonedToUtc(`${date.slice(0, 7)}-01`, "00:00").toISOString()
  const week = weekStart(date)
  const weekFrom = zonedToUtc(week, "00:00").toISOString()
  const weekTo = zonedToUtc(addDays(week, 7), "00:00").toISOString()
  const [settings, mcsRes] = await Promise.all([loadMowSettings(db), db.from("mow_customers").select("*").order("created_at")])
  const list = check(mcsRes, "mow customers") ?? []
  if (!list.length) return { settings, rows: [] }
  const [customers, cuts] = await Promise.all([
    db.from("customers").select("id,name,address,phone,email,lat,lng").in("id", list.map((m) => m.customer_id)),
    db.from("mow_cuts").select("mow_customer_id,cut_at,price").gte("cut_at", season).order("cut_at", { ascending: false }),
  ])
  const byId = new Map(((check(customers, "mow(customers)") ?? []) as Who[]).map((c) => [c.id, c]))
  const cutRows = (check(cuts, "mow(cuts)") ?? []) as Pick<MowCut, "mow_customer_id" | "cut_at" | "price">[]
  const rows = list.map((mc): MowRow => {
    const mine = cutRows.filter((c) => c.mow_customer_id === mc.id)
    const thisMonth = mine.filter((c) => c.cut_at >= month)
    return {
      mc,
      customer: byId.get(mc.customer_id) ?? { id: mc.customer_id, name: "Customer", address: null, phone: null, email: null, lat: null, lng: null },
      monthCuts: thisMonth.length,
      monthTotal: thisMonth.reduce((a, c) => a + Number(c.price), 0),
      seasonCuts: mine.length,
      lastCut: mine[0]?.cut_at ?? null,
      dueWeek: dueThisWeek(mc.frequency, mc.anchor_date, date),
      cutWeek: mine.some((c) => c.cut_at >= weekFrom && c.cut_at < weekTo),
    }
  })
  rows.sort((a, b) => Number(b.mc.active) - Number(a.mc.active) || a.customer.name.localeCompare(b.customer.name))
  return { settings, rows }
}

/** One day's mowing route: customers due that day, from the shop, starting at the start time. */
export async function loadMowRoutePlan(db: Db, date: string, trucks: number): Promise<{ plan: RoutePlan; settings: MowSettings; rows: MowRow[]; due: MowRow[] }> {
  const [{ settings, rows }, ops] = await Promise.all([loadMowRows(db, date), getSettings(db)])
  const base = { lat: ops.base_lat ?? opsConfig.defaultBase.lat, lng: ops.base_lng ?? opsConfig.defaultBase.lng }
  const due = rows.filter((r) => dueOnDate(r.mc, date, r.cutWeek))
  const plan = planSnowRoute({
    base,
    trucks,
    mph: Number(settings.drive_mph),
    startAt: zonedToUtc(date, settings.start_time.slice(0, 5)),
    stops: due.map((r) => ({
      id: r.mc.id,
      name: r.customer.name,
      address: r.customer.address,
      lat: r.customer.lat,
      lng: r.customer.lng,
      minutes: r.mc.est_minutes ?? settings.default_minutes,
    })),
  })
  return { plan, settings, rows, due }
}

export type MowBillRow = {
  mc: MowCustomer
  name: string
  phone: string | null
  email: string | null
  cuts: number
  amount: number
  payMethod: SnowPayMethod | null
  paidAt: string | null
}

/** Each customer's mowing bill for a month ("YYYY-MM-01"): the cuts that month at the price logged. Paid bills keep their amount. */
export async function loadMowBills(db: Db, month: string): Promise<{ rows: MowBillRow[] }> {
  const from = zonedToUtc(month, "00:00").toISOString()
  const to = zonedToUtc(nextMonth(month), "00:00").toISOString()
  const [mcsRes, cutsRes, billsRes] = await Promise.all([
    db.from("mow_customers").select("*"),
    db.from("mow_cuts").select("mow_customer_id,price").gte("cut_at", from).lt("cut_at", to),
    db.from("mow_bills").select("*").eq("month", month),
  ])
  const mcs = check(mcsRes, "mow bills(customers)") ?? []
  const cuts = (check(cutsRes, "mow bills(cuts)") ?? []) as Pick<MowCut, "mow_customer_id" | "price">[]
  const bills = new Map(((check(billsRes, "mow bills(bills)") ?? []) as MowBill[]).map((b) => [b.mow_customer_id, b]))
  const cut = new Set(cuts.map((c) => c.mow_customer_id))
  const included = mcs.filter((m) => cut.has(m.id) || bills.has(m.id))
  type P = { id: string; name: string; phone: string | null; email: string | null }
  const people = included.length
    ? new Map(((check(await db.from("customers").select("id,name,phone,email").in("id", included.map((m) => m.customer_id)), "mow bills(names)") ?? []) as P[]).map((c) => [c.id, c]))
    : new Map<string, P>()
  const rows = included.map((mc): MowBillRow => {
    const mine = cuts.filter((c) => c.mow_customer_id === mc.id)
    const bill = bills.get(mc.id)
    const paid = !!bill?.paid_at
    const p = people.get(mc.customer_id)
    return {
      mc,
      name: p?.name ?? "Customer",
      phone: p?.phone ?? null,
      email: p?.email ?? null,
      cuts: paid ? bill!.cuts : mine.length,
      amount: paid ? Number(bill!.amount) : mine.reduce((a, c) => a + Number(c.price), 0),
      payMethod: bill?.pay_method ?? mc.pay_method ?? null,
      paidAt: bill?.paid_at ?? null,
    }
  })
  rows.sort((a, b) => Number(!!a.paidAt) - Number(!!b.paidAt) || a.name.localeCompare(b.name))
  return { rows }
}
