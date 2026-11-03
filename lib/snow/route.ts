/**
 * Snow route planner. Pure: no database, no clock.
 *
 * Orders the driveways with nearest-neighbour from the shop, tightens it with 2-opt, splits the tour
 * across trucks (contiguous chunks, balanced by time), then works back from the finish-by time so
 * every truck's last driveway is done by then. Drive time is straight-line miles × a road factor at a
 * slow snow-day speed, so it errs long.
 */
import { haversineMiles } from "../geo/distance";

export type LatLng = { lat: number; lng: number };

export type RouteInputStop = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Minutes to clear this driveway. */
  minutes: number;
};

export type PlannedStop = RouteInputStop & {
  lat: number;
  lng: number;
  truck: number;
  driveMinutes: number;
  arriveAt: Date;
  doneAt: Date;
};

export type TruckPlan = {
  truck: number;
  stops: PlannedStop[];
  startAt: Date;
  finishAt: Date;
  driveMinutes: number;
  workMinutes: number;
  /** Google Maps directions, ≤ 10 stops per link. */
  mapsUrls: string[];
};

export type RoutePlan = {
  trucks: TruckPlan[];
  /** Driveways with no map location: not in the route. */
  unrouted: RouteInputStop[];
  /** Earliest truck start. */
  startAt: Date | null;
  finishBy: Date;
};

/** Road distance is longer than a straight line. */
export const ROAD_FACTOR = 1.35;

export function driveMinutes(a: LatLng, b: LatLng, mph: number): number {
  const miles = haversineMiles(a, b) * ROAD_FACTOR;
  if (miles < 0.01) return 0;
  return Math.max(1, Math.ceil((miles / Math.max(1, mph)) * 60));
}

type Located = RouteInputStop & LatLng;

function pathMinutes(base: LatLng, order: Located[], mph: number): number {
  let t = 0
  let at: LatLng = base
  for (const s of order) {
    t += driveMinutes(at, s, mph) + s.minutes
    at = s
  }
  return t
}

/** Nearest neighbour from the base, then 2-opt on the open path (the trucks don't need to come back). */
export function orderStops(base: LatLng, stops: Located[], mph: number): Located[] {
  const left = [...stops]
  const order: Located[] = []
  let at: LatLng = base
  while (left.length) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < left.length; i++) {
      const d = haversineMiles(at, left[i])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const [next] = left.splice(best, 1)
    order.push(next)
    at = next
  }
  // 2-opt: reverse any segment that shortens the path; a few passes is plenty at this size.
  let improved = true
  for (let pass = 0; improved && pass < 20; pass++) {
    improved = false
    const current = pathMinutes(base, order, mph)
    for (let i = 0; i < order.length - 1 && !improved; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const trial = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)]
        if (pathMinutes(base, trial, mph) < current - 0.5) {
          order.splice(0, order.length, ...trial)
          improved = true
          break
        }
      }
    }
  }
  return order
}

/** Cut the ordered tour into `trucks` contiguous runs with roughly equal time. */
export function splitAcrossTrucks(base: LatLng, order: Located[], trucks: number, mph: number): Located[][] {
  const n = Math.max(1, Math.min(trucks, order.length || 1))
  if (n === 1) return [order]
  const total = pathMinutes(base, order, mph)
  const target = total / n
  const runs: Located[][] = []
  let run: Located[] = []
  for (let i = 0; i < order.length; i++) {
    run.push(order[i])
    const remainingStops = order.length - i - 1
    const runsLeft = n - runs.length - 1
    if (runsLeft > 0 && (pathMinutes(base, run, mph) >= target || remainingStops === runsLeft)) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return runs
}

export function mapsUrls(base: LatLng, stops: LatLng[]): string[] {
  const urls: string[] = []
  const pt = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
  let origin = base
  for (let i = 0; i < stops.length; i += 10) {
    const chunk = stops.slice(i, i + 10)
    const dest = chunk[chunk.length - 1]
    const u = new URL("https://www.google.com/maps/dir/")
    u.searchParams.set("api", "1")
    u.searchParams.set("origin", pt(origin))
    u.searchParams.set("destination", pt(dest))
    if (chunk.length > 1) u.searchParams.set("waypoints", chunk.slice(0, -1).map(pt).join("|"))
    u.searchParams.set("travelmode", "driving")
    urls.push(u.toString())
    origin = dest
  }
  return urls
}

export function planSnowRoute(input: { base: LatLng; stops: RouteInputStop[]; trucks: number; mph: number; finishBy: Date }): RoutePlan {
  const located = input.stops.filter((s): s is Located => s.lat !== null && s.lng !== null)
  const unrouted = input.stops.filter((s) => s.lat === null || s.lng === null)
  if (!located.length) return { trucks: [], unrouted, startAt: null, finishBy: input.finishBy }

  const order = orderStops(input.base, located, input.mph)
  const runs = splitAcrossTrucks(input.base, order, input.trucks, input.mph)
  const trucks: TruckPlan[] = runs.map((run, idx) => {
    const total = pathMinutes(input.base, run, input.mph)
    const startAt = new Date(input.finishBy.getTime() - total * 60_000)
    let t = startAt.getTime()
    let at: LatLng = input.base
    let drive = 0
    let work = 0
    const stops: PlannedStop[] = run.map((s) => {
      const d = driveMinutes(at, s, input.mph)
      drive += d
      work += s.minutes
      const arriveAt = new Date(t + d * 60_000)
      const doneAt = new Date(arriveAt.getTime() + s.minutes * 60_000)
      t = doneAt.getTime()
      at = s
      return { ...s, truck: idx + 1, driveMinutes: d, arriveAt, doneAt }
    })
    return { truck: idx + 1, stops, startAt, finishAt: new Date(t), driveMinutes: drive, workMinutes: work, mapsUrls: mapsUrls(input.base, run) }
  })
  const startAt = new Date(Math.min(...trucks.map((t) => t.startAt.getTime())))
  return { trucks, unrouted, startAt, finishBy: input.finishBy }
}
