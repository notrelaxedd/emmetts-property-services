"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Map as MapIcon, MapPinOff, Pencil, RotateCcw, Route, X } from "lucide-react"
import { locateMissingHouses, saveRouteStart } from "@/app/admin/actions/map"
import type { MapData } from "@/app/admin/map/load"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RouteStartKey } from "@/lib/db/types"
import { planDayRoute } from "@/lib/routes/day"
import type { StartSlot } from "@/lib/routes/starts"
import { addDays } from "@/lib/scheduler/time"
import { cn } from "@/lib/utils"
import { HOUSE_COLORS, type MapHouse } from "./house"

const HousesMap = dynamic(() => import("./houses-map").then((m) => m.HousesMap), {
  ssr: false,
  loading: () => <div className="h-[26rem] animate-pulse rounded-lg bg-gray-light sm:h-[34rem]" aria-hidden="true" />,
})

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" })
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`)
const miles = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} mi`
const located = (s: StartSlot): s is StartSlot & { lat: number; lng: number } => s.lat !== null && s.lng !== null

type Props = MapData & { date: string; today: string; initialFrom: RouteStartKey | null }

export function MapBoard({ date, today, initialFrom, houses, jobs, starts, base }: Props) {
  const router = useRouter()
  const { pending, run } = useActionRunner()

  // ---- where the route starts
  const [from, setFrom] = React.useState<RouteStartKey | null>(initialFrom)
  const [editing, setEditing] = React.useState<RouteStartKey | null>(null)
  const chosen = starts.find((s) => s.key === from && located(s)) ?? starts.find(located) ?? null
  const start = chosen && located(chosen) ? { lat: chosen.lat, lng: chosen.lng, label: chosen.label } : { ...base, label: "Service area centre" }
  const url = (d: string, f: RouteStartKey | null) => `/admin/map?date=${d}${f ? `&from=${f}` : ""}`
  const pickStart = (s: StartSlot) => {
    if (!located(s)) return setEditing(s.key)
    setFrom(s.key)
    window.history.replaceState(null, "", url(date, s.key))
  }

  // ---- which houses are on the route: the day's booked jobs to begin with
  const jobsByHouse = React.useMemo(() => {
    const m = new Map<string, string[]>()
    for (const j of jobs) m.set(j.customerId, [...(m.get(j.customerId) ?? []), [j.time, ...j.services].join(" · ")])
    return m
  }, [jobs])
  const bookedIds = React.useMemo(() => Array.from(jobsByHouse.keys()), [jobsByHouse])
  const [picked, setPicked] = React.useState<string[]>(bookedIds)
  const toggle = React.useCallback((id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])), [])
  const changed = picked.length !== bookedIds.length || picked.some((id) => !bookedIds.includes(id))

  const onMap = React.useMemo(() => houses.filter((h): h is typeof h & { lat: number; lng: number } => h.lat !== null && h.lng !== null), [houses])
  const route = React.useMemo(
    () => planDayRoute({ lat: start.lat, lng: start.lng }, onMap.filter((h) => picked.includes(h.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start.lat, start.lng, onMap, picked],
  )
  const orderOf = new Map(route.stops.map((s) => [s.id, s.order]))
  const mapHouses: MapHouse[] = onMap.map((h) => ({ ...h, booked: jobsByHouse.get(h.id)?.join("; ") ?? null, order: orderOf.get(h.id) ?? null }))

  const offMap = houses.filter((h) => h.lat === null || h.lng === null)
  const bookedOffMap = offMap.filter((h) => jobsByHouse.has(h.id))
  const findable = offMap.filter((h) => h.address?.trim()).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="map-day">Day</Label>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" aria-label="Day before" onClick={() => router.push(url(addDays(date, -1), from))}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Input id="map-day" type="date" value={date} className="w-auto" onChange={(e) => e.target.value && router.push(url(e.target.value, from))} />
            <Button type="button" variant="outline" size="icon" aria-label="Day after" onClick={() => router.push(url(addDays(date, 1), from))}>
              <ChevronRight aria-hidden="true" />
            </Button>
            {date !== today ? (
              <Button type="button" variant="ghost" onClick={() => router.push(url(today, from))}>
                Today
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium leading-none text-ink">Leaving from</span>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Leaving from">
            {starts.map((s) => {
              const on = chosen?.key === s.key
              return (
                <span key={s.key} className="inline-flex">
                  <Button
                    type="button"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    className={cn("rounded-r-none", !located(s) && "border-dashed text-ink-muted")}
                    onClick={() => pickStart(s)}
                  >
                    {s.label}
                    {located(s) ? "" : ": set address"}
                  </Button>
                  <Button
                    type="button"
                    variant={on ? "default" : "outline"}
                    size="icon"
                    className="-ml-px rounded-l-none"
                    aria-label={`Change the address for ${s.label}`}
                    onClick={() => setEditing(editing === s.key ? null : s.key)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {editing ? (
        <StartEditor
          key={editing}
          slot={starts.find((s) => s.key === editing) as StartSlot}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSave={(address) =>
            void run(() => saveRouteStart(editing, address), {
              onSuccess: () => {
                setFrom(editing)
                window.history.replaceState(null, "", url(date, editing))
                setEditing(null)
                router.refresh()
              },
            })
          }
        />
      ) : null}
      {!chosen && !editing ? (
        <p className="text-sm text-ink-muted">No start point saved yet, so the route starts from the middle of the service area. Set an address above.</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-2">
          <HousesMap houses={mapHouses} start={start} onToggle={toggle} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Map key">
            <Key color="#1F2A26" label="On the route (numbered)" />
            <Key color={HOUSE_COLORS.mowing} label="Mowing" />
            <Key color={HOUSE_COLORS.snow} label="Snow" />
            <Key color={HOUSE_COLORS.both} label="Mowing + snow" />
            <Key color={HOUSE_COLORS.other} label="Other customers" />
            <li>Tap a house to add it to the route or take it off.</li>
          </ul>
        </div>

        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="size-4 text-brand-green-dark" aria-hidden="true" />
              {dayLabel.format(new Date(`${date}T12:00:00Z`))}
            </CardTitle>
            <CardDescription>
              {route.stops.length
                ? `${route.stops.length} stop${route.stops.length === 1 ? "" : "s"} from ${start.label} · about ${miles(route.miles)} · ${dur(route.driveMinutes)} driving`
                : bookedIds.length
                  ? "Nothing on the route. Tap houses on the map, or put the booked jobs back."
                  : "No jobs booked this day. Tap houses on the map to build a route."}
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              {route.mapsUrls.map((u, i) => (
                <Button key={u} asChild size="sm">
                  <a href={u} target="_blank" rel="noopener noreferrer">
                    <MapIcon aria-hidden="true" /> {route.mapsUrls.length > 1 ? `Directions ${i + 1}/${route.mapsUrls.length}` : "Open in Google Maps"}
                  </a>
                </Button>
              ))}
              {changed ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setPicked(bookedIds)}>
                  <RotateCcw aria-hidden="true" /> {bookedIds.length ? "Back to booked jobs" : "Clear"}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          {route.stops.length ? (
            <CardContent>
              <ol className="divide-y divide-ink/10">
                {route.stops.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 py-2">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{s.order}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/customers/${s.id}`} className="block truncate font-semibold text-ink hover:underline">
                        {s.name}
                      </Link>
                      <p className="truncate text-xs text-ink-muted">{s.address ?? ""}</p>
                      {(jobsByHouse.get(s.id) ?? []).map((j) => (
                        <p key={j} className="text-xs font-medium text-ink">
                          {j}
                        </p>
                      ))}
                      <p className="text-xs text-ink-muted">
                        {dur(s.driveMinutes)} drive · {miles(s.miles)} from {s.order === 1 ? start.label : "the last stop"}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Take ${s.name} off the route`} onClick={() => toggle(s.id)}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ol>
            </CardContent>
          ) : null}
        </Card>
      </div>

      {offMap.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinOff className="size-4 text-amber-600" aria-hidden="true" /> Not on the map ({offMap.length})
            </CardTitle>
            <CardDescription>
              {bookedOffMap.length
                ? `${bookedOffMap.length} of these ${bookedOffMap.length === 1 ? "has a job" : "have jobs"} this day and ${bookedOffMap.length === 1 ? "is" : "are"} missing from the route. `
                : ""}
              These houses have no map location yet. Look them up, or fix the address on the customer&apos;s page.
            </CardDescription>
            {findable ? (
              <div className="pt-1">
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => locateMissingHouses(), { onSuccess: () => router.refresh() })}>
                  {pending ? "Looking up…" : `Look up ${Math.min(findable, 25)} address${Math.min(findable, 25) === 1 ? "" : "es"}`}
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[...bookedOffMap, ...offMap.filter((h) => !jobsByHouse.has(h.id))].slice(0, 40).map((h) => (
                <li key={h.id} className="truncate">
                  <Link href={`/admin/customers/${h.id}`} className="font-medium text-ink underline">
                    {h.name}
                  </Link>{" "}
                  <span className="text-ink-muted">{h.address ?? "no address"}</span>
                  {jobsByHouse.has(h.id) ? <span className="font-medium text-amber-700"> · booked this day</span> : null}
                </li>
              ))}
            </ul>
            {offMap.length > 40 ? <p className="pt-2 text-xs text-ink-muted">and {offMap.length - 40} more</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="inline-block size-3 rounded-full border border-white shadow" style={{ background: color }} aria-hidden="true" />
      {label}
    </li>
  )
}

function StartEditor({ slot, pending, onSave, onCancel }: { slot: StartSlot; pending: boolean; onSave: (address: string) => void; onCancel: () => void }) {
  const [address, setAddress] = React.useState(slot.address ?? "")
  const id = React.useId()
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-ink/10 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(address)
      }}
    >
      <div className="grid min-w-64 flex-1 gap-1.5">
        <Label htmlFor={id}>Address for {slot.label}</Label>
        <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Rocky River, OH 44116" autoFocus autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending || !address.trim()}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}
