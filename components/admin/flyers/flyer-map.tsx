"use client"

import "leaflet/dist/leaflet.css"
import * as React from "react"
import type * as Leaflet from "leaflet"
import { LocateFixed, Undo2 } from "lucide-react"
import { markStreets, undoStreetMarks, type StreetMark } from "@/app/admin/actions/flyers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { MapStreet } from "@/lib/flyers/street-data"
import { DUE_AFTER_DAYS, coverageStatus, daysBetween, sameStreet, type CoverageStatus } from "@/lib/flyers/streets"

export type MapWorker = { id: string; name: string; code: string }
export type MapLead = { id: string; lat: number; lng: number; label: string; booked: boolean; worker: string }

const COLORS: Record<CoverageStatus, string> = { covered: "#16a34a", due: "#f59e0b", never: "#64748b" }
/** Zoom at which every street loads; between COVERED_ZOOM and this only flyered streets show. */
const LOAD_ZOOM = 15
const COVERED_ZOOM = 11
/** Rocky River, until the map remembers where you were. */
const DEFAULT_VIEW = { lat: 41.4834, lng: -81.8393, zoom: 15 }
const VIEW_KEY = "flyer-map:view"
const WORKER_KEY = "flyer-map:worker"
/** Drop streets far outside the view once this many are on the map. */
const MAX_CACHED = 15000

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the map just won't remember.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

export function FlyerMap({ workers, leads, today }: { workers: MapWorker[]; leads: MapLead[]; today: string }) {
  const { toast } = useToast()
  const box = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<Leaflet.Map | null>(null)
  const LRef = React.useRef<typeof Leaflet | null>(null)
  const lines = React.useRef(new Map<string, Leaflet.Polyline>())
  const streets = React.useRef(new Map<string, MapStreet>())
  const workerName = React.useMemo(() => new Map(workers.map((w) => [w.id, w.name])), [workers])

  const [workerId, setWorkerId] = React.useState("")
  const [date, setDate] = React.useState(today)
  const [whole, setWhole] = React.useState(false)
  const [show, setShow] = React.useState("all")
  const [status, setStatus] = React.useState<string | null>("Loading map…")
  const [lastAction, setLastAction] = React.useState<{ label: string; markIds: string[] } | null>(null)
  const [restyle, setRestyle] = React.useState(0)

  // Leaflet handlers are bound once; they read the current settings through this ref.
  const settings = React.useRef({ workerId, date, whole, show })
  settings.current = { workerId, date, whole, show }

  React.useEffect(() => {
    const saved = readStorage(WORKER_KEY)
    if (saved && workers.some((w) => w.id === saved)) setWorkerId(saved)
  }, [workers])

  const styleFor = React.useCallback(
    (s: MapStreet): Leaflet.PolylineOptions => {
      let st = coverageStatus(s.last?.coveredOn, today)
      // Filtered to one worker: everyone else's streets draw as not yet flyered.
      if (settings.current.show !== "all" && s.last?.workerId !== settings.current.show) st = "never"
      return st === "never"
        ? { color: COLORS.never, weight: 4, opacity: 0.55 }
        : { color: COLORS[st], weight: 7, opacity: 0.9 }
    },
    [today],
  )

  const applyMarks = React.useCallback((marks: { streetId: string; last: StreetMark | null }[]) => {
    for (const { streetId, last } of marks) {
      const s = streets.current.get(streetId)
      if (!s) continue
      s.last = last ? { markId: last.markId, coveredOn: last.coveredOn, workerId: last.workerId } : null
      lines.current.get(streetId)?.setStyle(styleFor(s))
    }
  }, [styleFor])

  const mark = React.useCallback(
    async (targets: MapStreet[]) => {
      const { workerId: who, date: on } = settings.current
      const r = await markStreets({ streetIds: targets.map((t) => t.id), workerId: who || null, date: on })
      if (!r.ok) {
        toast({ title: "Couldn't mark that street", description: r.reason, variant: "destructive" })
        return
      }
      // A back-dated mark only recolours a street if it's newer than what's already there.
      applyMarks(
        r.marks
          .filter((m) => {
            const cur = streets.current.get(m.streetId)?.last
            return !cur || cur.coveredOn <= m.coveredOn
          })
          .map((m) => ({ streetId: m.streetId, last: m })),
      )
      const name = targets[0]?.name ?? "Street"
      setLastAction({ label: targets.length > 1 ? `${name} (${targets.length} sections)` : name, markIds: r.marks.map((m) => m.markId) })
    },
    [applyMarks, toast],
  )

  const undo = React.useCallback(
    async (markIds: string[]) => {
      const r = await undoStreetMarks(markIds)
      if (!r.ok) {
        toast({ title: "Couldn't undo", description: r.reason, variant: "destructive" })
        return false
      }
      applyMarks(r.streets)
      return true
    },
    [applyMarks, toast],
  )

  const onTap = React.useCallback(
    (id: string, latlng: Leaflet.LatLng) => {
      const s = streets.current.get(id)
      const map = mapRef.current
      const L = LRef.current
      if (!s || !map || !L) return
      const st = coverageStatus(s.last?.coveredOn, today)
      if (st !== "covered" || !s.last) {
        void mark(settings.current.whole ? sameStreet(s, streets.current.values()) : [s])
        return
      }
      // Already done this month: show who and when, with undo / mark again.
      const last = s.last
      const div = el("div", "space-y-2 text-sm")
      div.append(el("p", "font-semibold text-ink", s.name))
      const ago = daysBetween(last.coveredOn, today)
      const who = last.workerId ? workerName.get(last.workerId) ?? "a removed worker" : null
      div.append(
        el("p", "text-ink-muted", `Flyered ${shortDate(last.coveredOn)} (${ago === 0 ? "today" : `${ago} day${ago === 1 ? "" : "s"} ago`})${who ? ` by ${who}` : ""}.`),
      )
      const row = el("div", "flex gap-2")
      const undoBtn = el("button", "rounded-md border border-ink/20 px-2 py-1 text-xs font-medium text-ink hover:bg-accent", "Undo")
      undoBtn.type = "button"
      undoBtn.onclick = async () => {
        if (await undo([last.markId])) map.closePopup()
      }
      const againBtn = el("button", "rounded-md bg-ink px-2 py-1 text-xs font-medium text-white hover:bg-ink/85", "Mark again")
      againBtn.type = "button"
      againBtn.onclick = async () => {
        map.closePopup()
        await mark(settings.current.whole ? sameStreet(s, streets.current.values()) : [s])
      }
      row.append(undoBtn, againBtn)
      div.append(row)
      L.popup({ closeButton: true }).setLatLng(latlng).setContent(div).openOn(map)
    },
    [mark, undo, today, workerName],
  )

  const addStreets = React.useCallback(
    (list: MapStreet[]) => {
      const map = mapRef.current
      const L = LRef.current
      if (!map || !L) return
      for (const s of list) {
        const existing = streets.current.get(s.id)
        if (existing) {
          existing.last = s.last
          lines.current.get(s.id)?.setStyle(styleFor(existing))
          continue
        }
        streets.current.set(s.id, s)
        const line = L.polyline(s.path, styleFor(s)).addTo(map)
        line.on("click", (e: Leaflet.LeafletMouseEvent) => {
          L.DomEvent.stop(e)
          onTap(s.id, e.latlng)
        })
        lines.current.set(s.id, line)
      }
      if (streets.current.size > MAX_CACHED) {
        const view = map.getBounds().pad(0.5)
        streets.current.forEach((s, id) => {
          if (!view.intersects(L.latLngBounds(s.path))) {
            lines.current.get(id)?.remove()
            lines.current.delete(id)
            streets.current.delete(id)
          }
        })
      }
    },
    [onTap, styleFor],
  )

  // Restyle everything when the worker filter changes.
  React.useEffect(() => {
    streets.current.forEach((s, id) => lines.current.get(id)?.setStyle(styleFor(s)))
  }, [show, restyle, styleFor])

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inflight: AbortController | null = null
    const lineMap = lines.current
    const streetMap = streets.current

    async function load() {
      const map = mapRef.current
      if (!map) return
      const z = map.getZoom()
      const b = map.getBounds()
      const c = map.getCenter()
      writeStorage(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: z }))
      if (z < COVERED_ZOOM) {
        setStatus("Zoom in to see streets.")
        return
      }
      const mode = z >= LOAD_ZOOM ? "all" : "covered"
      const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(",")
      inflight?.abort()
      const ctrl = (inflight = new AbortController())
      setStatus(mode === "all" ? "Loading streets…" : "Showing flyered streets. Zoom in to load every street.")
      try {
        const res = await fetch(`/admin/employees/flyers/map/streets?mode=${mode}&bbox=${bbox}`, { signal: ctrl.signal })
        const body = (await res.json()) as { streets?: MapStreet[]; warning?: string; error?: string }
        if (cancelled || ctrl.signal.aborted) return
        if (!res.ok || !body.streets) {
          setStatus(body.error ?? "Couldn't load streets.")
          return
        }
        addStreets(body.streets)
        if (mode === "all") setStatus(body.warning ? `Some streets didn't load: ${body.warning}. Move the map to retry.` : null)
      } catch (e) {
        if (!ctrl.signal.aborted) setStatus(e instanceof Error ? e.message : "Couldn't load streets.")
      }
    }

    ;(async () => {
      const mod = await import("leaflet")
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet
      if (cancelled || !box.current) return
      LRef.current = L
      let view = DEFAULT_VIEW
      try {
        const saved = JSON.parse(readStorage(VIEW_KEY) ?? "null")
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) && Number.isFinite(saved.zoom)) view = saved
      } catch {
        // Ignore a bad saved view.
      }
      // Canvas with a wide tolerance: streets are easy to tap with a thumb.
      const map = L.map(box.current, { renderer: L.canvas({ tolerance: 12 }) }).setView([view.lat, view.lng], view.zoom)
      mapRef.current = map
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)

      for (const lead of leads) {
        const popup = el("div", "space-y-1 text-sm")
        const link = el("a", "font-semibold text-ink underline", lead.label)
        link.href = `/admin/leads/${lead.id}`
        popup.append(link, el("p", "text-ink-muted", `${lead.booked ? "Booked" : "Quote request"} · from ${lead.worker}'s flyer`))
        L.circleMarker([lead.lat, lead.lng], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: lead.booked ? COLORS.covered : "#ea580c",
          fillOpacity: 1,
        })
          .bindPopup(popup)
          .addTo(map)
      }

      map.on("moveend", () => {
        clearTimeout(timer)
        timer = setTimeout(load, 350)
      })
      map.on("locationerror", () => setStatus("Couldn't find your location. Check location permission for this site."))
      setRestyle((n) => n + 1)
      void load()
    })()

    return () => {
      cancelled = true
      clearTimeout(timer)
      inflight?.abort()
      mapRef.current?.remove()
      mapRef.current = null
      lineMap.clear()
      streetMap.clear()
    }
    // Set up once; handlers read current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const locate = () => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    map.locate({ setView: true, maxZoom: 17 })
    map.once("locationfound", (e: Leaflet.LocationEvent) => {
      L.circleMarker(e.latlng, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map)
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 lg:grid-cols-[1fr_10rem_1fr_1fr] lg:gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fm-worker">Handed out by</Label>
          <NativeSelect
            id="fm-worker"
            value={workerId}
            onChange={(e) => {
              setWorkerId(e.target.value)
              writeStorage(WORKER_KEY, e.target.value)
            }}
          >
            <option value="">Not recorded</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fm-date">On</Label>
          <Input id="fm-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fm-tap">A tap marks</Label>
          <NativeSelect id="fm-tap" value={whole ? "street" : "block"} onChange={(e) => setWhole(e.target.value === "street")}>
            <option value="block">Just that section</option>
            <option value="street">The whole street</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fm-show">Show</Label>
          <NativeSelect id="fm-show" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">Everyone’s streets</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                Only {w.name}’s
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full" style={{ background: COLORS.covered }} /> Flyered in the last {DUE_AFTER_DAYS} days
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full" style={{ background: COLORS.due }} /> Due again
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-5 rounded-full opacity-60" style={{ background: COLORS.never }} /> Not yet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: "#ea580c" }} /> Quote request
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: COLORS.covered }} /> Booked
        </span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={locate}>
          <LocateFixed /> Where am I
        </Button>
      </div>

      <div className="relative">
        <div ref={box} className="h-[calc(100dvh-20rem)] min-h-[420px] w-full overflow-hidden rounded-lg border border-ink/15 bg-gray-light outline-none focus-visible:ring-2 focus-visible:ring-ink" />
        {status ? (
          <p className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
            {status}
          </p>
        ) : null}
        {lastAction ? (
          <div className="absolute inset-x-3 bottom-3 z-[1000] flex items-center justify-between gap-2 rounded-md bg-ink px-3 py-2 text-sm text-white shadow-lg sm:inset-x-auto sm:right-3">
            <span className="truncate">Marked {lastAction.label}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/40 bg-transparent text-white hover:bg-white/10"
              onClick={async () => {
                const ids = lastAction.markIds
                setLastAction(null)
                await undo(ids)
              }}
            >
              <Undo2 /> Undo
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">
        Tap a gray street to mark it flyered. Tap a green one to see when and by whom, or to undo. Streets load from
        OpenStreetMap the first time you look at an area.
      </p>
    </div>
  )
}
