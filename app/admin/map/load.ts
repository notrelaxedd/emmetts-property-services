import "server-only"

import { opsConfig } from "@/lib/config"
import type { JobStatus } from "@/lib/db/types"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { startSlots, type StartSlot } from "@/lib/routes/starts"
import { addDays, formatTimeRange, zonedToUtc } from "@/lib/scheduler/time"

export type House = {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  mowing: boolean
  snow: boolean
}

export type DayJob = { id: string; customerId: string; status: JobStatus; time: string; services: string[] }

export type MapData = {
  houses: House[]
  jobs: DayJob[]
  starts: StartSlot[]
  /** Used until a start point is saved: the service-area centre. */
  base: { lat: number; lng: number }
}

/** Job states that mean "we're going to that house that day". */
const ON_THE_DAY: JobStatus[] = ["proposed", "crew_confirmed", "booked", "in_progress", "done"]

/** Every house on file, the jobs on the calendar for `date`, and the saved start points. THROWS on a query error. */
export async function loadMapData(db: Db, date: string): Promise<MapData> {
  const from = zonedToUtc(date, "00:00").toISOString()
  const to = zonedToUtc(addDays(date, 1), "00:00").toISOString()
  const [settings, customersRes, mowRes, snowRes, jobsRes] = await Promise.all([
    getSettings(db),
    db.from("customers").select("id,name,address,lat,lng").order("name"),
    db.from("mow_customers").select("customer_id").eq("active", true),
    db.from("snow_customers").select("customer_id").eq("active", true),
    db.from("jobs").select("id,customer_id,quote_id,status,start_at,end_at,est_minutes").gte("start_at", from).lt("start_at", to).in("status", ON_THE_DAY).order("start_at"),
  ])
  const mowing = new Set(((check(mowRes, "map(mowing)") ?? []) as { customer_id: string }[]).map((r) => r.customer_id))
  const snow = new Set(((check(snowRes, "map(snow)") ?? []) as { customer_id: string }[]).map((r) => r.customer_id))
  type C = Pick<House, "id" | "name" | "address" | "lat" | "lng">
  const houses = ((check(customersRes, "map(customers)") ?? []) as C[]).map((c): House => ({ ...c, mowing: mowing.has(c.id), snow: snow.has(c.id) }))

  type J = { id: string; customer_id: string; quote_id: string | null; status: JobStatus; start_at: string; end_at: string | null; est_minutes: number }
  const jobRows = (check(jobsRes, "map(jobs)") ?? []) as J[]
  const quoteIds = Array.from(new Set(jobRows.map((j) => j.quote_id).filter((q): q is string => !!q)))
  const items = quoteIds.length
    ? ((check(await db.from("quote_items").select("quote_id,description,sort_order,status").in("quote_id", quoteIds), "map(items)") ?? []) as {
        quote_id: string
        description: string
        sort_order: number
        status: string
      }[])
    : []
  const services = new Map<string, string[]>()
  for (const i of items.sort((a, b) => a.sort_order - b.sort_order)) {
    if (i.status === "auto" || i.status === "priced") services.set(i.quote_id, [...(services.get(i.quote_id) ?? []), i.description])
  }
  const jobs = jobRows.map((j): DayJob => {
    const start = new Date(j.start_at)
    const end = j.end_at ? new Date(j.end_at) : new Date(start.getTime() + j.est_minutes * 60_000)
    return { id: j.id, customerId: j.customer_id, status: j.status, time: formatTimeRange(start, end), services: j.quote_id ? (services.get(j.quote_id) ?? []) : [] }
  })

  return {
    houses,
    jobs,
    // Tolerates a database that doesn't have settings.route_starts yet (all three slots come back empty).
    starts: startSlots((settings as { route_starts?: unknown }).route_starts),
    base: { lat: settings.base_lat ?? opsConfig.defaultBase.lat, lng: settings.base_lng ?? opsConfig.defaultBase.lng },
  }
}
