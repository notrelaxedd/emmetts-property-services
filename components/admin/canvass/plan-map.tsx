"use client"

/**
 * The route map for "Plan my session": numbered stop markers, the walking polyline and a click-to-set start point.
 * Loaded with `next/dynamic` (ssr: false) from plan-form.tsx because Leaflet touches `window` at import time.
 *
 * Tiles come from map-shared.tsx. Leaflet's default marker icons are never used (they load from a CDN), only
 * CircleMarker / divIcon.
 */
import * as React from "react"
import L from "leaflet"
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import type { PlanStopView } from "@/lib/canvass/views"
import { MAX_ZOOM, OSM_ATTRIBUTION, OSM_TILES, SAT_ATTRIBUTION, SAT_TILES } from "./map-shared"

const STREET_TILES = { url: OSM_TILES, attribution: OSM_ATTRIBUTION, maxZoom: MAX_ZOOM }
const SATELLITE_TILES = { url: SAT_TILES, attribution: SAT_ATTRIBUTION, maxZoom: MAX_ZOOM }

export type LatLng = { lat: number; lng: number }

export type PlanMapProps = {
  center: LatLng
  /** Where the walk starts (base or a map click). */
  start: LatLng | null
  stops: PlanStopView[]
  /** When set, a click on the map reports a new start point. */
  onPick?: (point: LatLng) => void
  className?: string
}

function stopIcon(order: number): L.DivIcon {
  return L.divIcon({
    className: "canvass-stop-icon",
    html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:#1F2A26;color:#fff;font:600 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${order}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    tooltipAnchor: [0, -13],
  })
}

function ClickToPick({ onPick }: { onPick?: (point: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

/** Re-fits the view when the stops change; leaves it alone when the owner is only picking a start point. */
function FitStops({ stops, start }: { stops: PlanStopView[]; start: LatLng | null }) {
  const map = useMap()
  const key = stops.map((s) => s.id).join(",")
  React.useEffect(() => {
    const points: [number, number][] = stops
      .filter((s) => s.centroid_lat !== null && s.centroid_lng !== null)
      .map((s) => [s.centroid_lat as number, s.centroid_lng as number])
    if (start) points.push([start.lat, start.lng])
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 16)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 })
    // The start point alone should not re-fit; only a new list of stops does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

export function PlanMap({ center, start, stops, onPick, className }: PlanMapProps) {
  const [satellite, setSatellite] = React.useState(false)
  const tiles = satellite ? SATELLITE_TILES : STREET_TILES
  const route: [number, number][] = []
  if (start) route.push([start.lat, start.lng])
  for (const s of stops) if (s.centroid_lat !== null && s.centroid_lng !== null) route.push([s.centroid_lat, s.centroid_lng])

  return (
    <div className={className ?? "relative h-72 overflow-hidden rounded-lg border border-ink/10 sm:h-96"}>
      <MapContainer center={[center.lat, center.lng]} zoom={14} scrollWheelZoom className="h-full w-full" style={{ cursor: onPick ? "crosshair" : undefined }}>
        <TileLayer key={tiles.url} url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} maxNativeZoom={19} />
        <ClickToPick onPick={onPick} />
        <FitStops stops={stops} start={start} />
        {route.length > 1 ? <Polyline positions={route} pathOptions={{ color: "#327213", weight: 3, opacity: 0.85 }} /> : null}
        {start ? (
          <CircleMarker center={[start.lat, start.lng]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: "#327213", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -8]}>
              Start
            </Tooltip>
          </CircleMarker>
        ) : null}
        {stops.map((s) =>
          s.centroid_lat !== null && s.centroid_lng !== null ? (
            <Marker key={s.id} position={[s.centroid_lat, s.centroid_lng]} icon={stopIcon(s.order)} interactive>
              <Tooltip direction="top">
                {s.order}. {s.address} ({s.window.label})
              </Tooltip>
            </Marker>
          ) : null,
        )}
      </MapContainer>
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className="absolute right-2 top-2 z-[1000] rounded-md border border-ink/20 bg-white/95 px-2 py-1 text-xs font-medium text-ink shadow-sm hover:bg-white"
      >
        {satellite ? "Streets" : "Satellite"}
      </button>
      {onPick ? (
        <p className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-md bg-white/90 px-2 py-1 text-xs text-ink-muted">
          Click the map to set the start point
        </p>
      ) : null}
    </div>
  )
}
