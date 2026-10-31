"use client"

/**
 * Walk Mode map: numbered pins, the walking polyline and a blue dot for where the crew member is. Loaded from
 * walk-mode.tsx with `next/dynamic(..., { ssr: false })` because Leaflet touches `window` at import time.
 * Only divIcon / CircleMarker are used (Leaflet's default marker images load from a CDN).
 */
import L from "leaflet"
import * as React from "react"
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { MAX_ZOOM, OSM_ATTRIBUTION, OSM_TILES, SAT_ATTRIBUTION, SAT_TILES } from "@/components/admin/canvass/map-shared"
import type { WalkStopView } from "@/lib/canvass/views"

export type WalkMapProps = {
  stops: WalkStopView[]
  /** Parcels handled this session: greyed pins. */
  doneIds: ReadonlySet<string>
  currentId: string | null
  position: { lat: number; lng: number } | null
  /** Where the route starts (the position the walk was planned from). */
  start: { lat: number; lng: number } | null
  className?: string
}

function pinIcon(order: number, state: "current" | "done" | "todo"): L.DivIcon {
  const bg = state === "current" ? "#65C435" : state === "done" ? "#9CA3AF" : "#1F2A26"
  const fg = state === "current" ? "#0B0B0B" : "#fff"
  const size = state === "current" ? 34 : 26
  return L.divIcon({
    className: "canvass-walk-pin",
    html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:${fg};font:700 ${state === "current" ? 14 : 12}px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45)">${order}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/** Fit everything once per walk, then glide to each house as it becomes the current one. */
function Camera({ stops, currentId, start }: { stops: WalkStopView[]; currentId: string | null; start: WalkMapProps["start"] }) {
  const map = useMap()
  const key = stops.map((s) => s.id).join(",")
  React.useEffect(() => {
    const points: [number, number][] = stops.map((s) => [s.lat, s.lng])
    if (start) points.push([start.lat, start.lng])
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], 17)
    else map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 18 })
    // Re-fit only when the list of houses changes (a new plan), not on every GPS fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  React.useEffect(() => {
    const cur = stops.find((s) => s.id === currentId)
    if (cur) map.panTo([cur.lat, cur.lng], { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, map])
  return null
}

export function WalkMap({ stops, doneIds, currentId, position, start, className }: WalkMapProps) {
  const [satellite, setSatellite] = React.useState(false)
  const center = position ?? start ?? (stops[0] ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: 41.4756, lng: -81.8396 })
  const route: [number, number][] = []
  if (start) route.push([start.lat, start.lng])
  for (const s of stops) route.push([s.lat, s.lng])
  const tiles = satellite ? { url: SAT_TILES, attribution: SAT_ATTRIBUTION } : { url: OSM_TILES, attribution: OSM_ATTRIBUTION }

  return (
    <div className={className ?? "relative isolate h-56 overflow-hidden rounded-lg border border-ink/10"}>
      <MapContainer center={[center.lat, center.lng]} zoom={17} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer key={tiles.url} url={tiles.url} attribution={tiles.attribution} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
        <Camera stops={stops} currentId={currentId} start={start} />
        {route.length > 1 ? <Polyline positions={route} pathOptions={{ color: "#327213", weight: 3, opacity: 0.85 }} /> : null}
        {stops.map((s) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={pinIcon(s.order, s.id === currentId ? "current" : doneIds.has(s.id) ? "done" : "todo")}
            zIndexOffset={s.id === currentId ? 1000 : 0}
            keyboard={false}
          />
        ))}
        {position ? (
          <CircleMarker center={[position.lat, position.lng]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563EB", fillOpacity: 1 }} />
        ) : null}
      </MapContainer>
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className="absolute right-2 top-2 z-[1000] rounded-md border border-ink/20 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink shadow-sm hover:bg-white"
      >
        {satellite ? "Streets" : "Satellite"}
      </button>
    </div>
  )
}
