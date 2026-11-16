"use client"

/**
 * The Map tab's map: every house on file as a dot, the route's stops as numbered pins, the line between them and
 * the start point. Loaded with `next/dynamic` (ssr: false) from map-board.tsx because Leaflet touches `window` at
 * import time. Leaflet's default marker icons are never used (they load from a CDN): CircleMarker / divIcon only.
 */
import * as React from "react"
import Link from "next/link"
import L from "leaflet"
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { houseColor, type MapHouse } from "./house"
import { MAX_ZOOM, OSM_ATTRIBUTION, OSM_TILES, SAT_ATTRIBUTION, SAT_TILES } from "@/components/admin/canvass/map-shared"

function stopIcon(order: number): L.DivIcon {
  return L.divIcon({
    className: "map-stop-icon",
    html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:#1F2A26;color:#fff;font:600 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${order}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    tooltipAnchor: [0, -14],
  })
}

const START_ICON = L.divIcon({
  className: "map-start-icon",
  html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:6px;background:#65C435;color:#0B0B0B;font:700 11px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">GO</span>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  tooltipAnchor: [0, -15],
})

/** Fits the view to every house and the start once, when the map opens. */
function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap()
  React.useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], 15)
    else map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 })
    // Only on mount: re-fitting on every tap would throw the owner around the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

function HousePopup({ house, onToggle }: { house: MapHouse; onToggle: (id: string) => void }) {
  const map = useMap()
  const tags = [house.mowing ? "Mowing" : null, house.snow ? "Snow" : null].filter(Boolean).join(" · ")
  return (
    <Popup>
      <div className="min-w-44 space-y-1 text-sm">
        <p className="font-semibold text-ink">{house.name}</p>
        {house.address ? <p className="text-ink-muted">{house.address}</p> : null}
        {tags ? <p className="text-xs text-ink-muted">{tags}</p> : null}
        {house.booked ? <p className="text-xs font-medium text-ink">Booked: {house.booked}</p> : null}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            className="rounded-md bg-ink px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-ink/85"
            onClick={() => {
              onToggle(house.id)
              map.closePopup()
            }}
          >
            {house.order !== null ? "Take off route" : "Add to route"}
          </button>
          <Link href={`/admin/customers/${house.id}`} className="text-xs font-medium text-ink underline">
            Open customer
          </Link>
        </div>
      </div>
    </Popup>
  )
}

export type HousesMapProps = {
  houses: MapHouse[]
  start: { lat: number; lng: number; label: string }
  onToggle: (id: string) => void
}

export function HousesMap({ houses, start, onToggle }: HousesMapProps) {
  const [satellite, setSatellite] = React.useState(false)
  const tiles = satellite ? { url: SAT_TILES, attribution: SAT_ATTRIBUTION } : { url: OSM_TILES, attribution: OSM_ATTRIBUTION }
  const stops = houses.filter((h) => h.order !== null).sort((a, b) => (a.order as number) - (b.order as number))
  const line: [number, number][] = [[start.lat, start.lng], ...stops.map((s): [number, number] => [s.lat, s.lng])]
  const all: [number, number][] = [[start.lat, start.lng], ...houses.map((h): [number, number] => [h.lat, h.lng])]

  return (
    <div className="relative h-[26rem] overflow-hidden rounded-lg border border-ink/10 sm:h-[34rem]">
      <MapContainer center={[start.lat, start.lng]} zoom={13} scrollWheelZoom className="h-full w-full">
        <TileLayer key={tiles.url} url={tiles.url} attribution={tiles.attribution} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
        <FitAll points={all} />
        {line.length > 1 ? <Polyline positions={line} pathOptions={{ color: "#327213", weight: 4, opacity: 0.85 }} /> : null}
        {houses.map((h) =>
          h.order === null ? (
            <CircleMarker
              key={h.id}
              center={[h.lat, h.lng]}
              radius={h.booked ? 9 : 7}
              pathOptions={{ color: h.booked ? "#f59e0b" : "#fff", weight: h.booked ? 3 : 2, fillColor: houseColor(h), fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {h.name}
              </Tooltip>
              <HousePopup house={h} onToggle={onToggle} />
            </CircleMarker>
          ) : (
            <Marker key={`${h.id}-${h.order}`} position={[h.lat, h.lng]} icon={stopIcon(h.order)}>
              <Tooltip direction="top">
                {h.order}. {h.name}
              </Tooltip>
              <HousePopup house={h} onToggle={onToggle} />
            </Marker>
          ),
        )}
        <Marker position={[start.lat, start.lng]} icon={START_ICON} interactive zIndexOffset={1000}>
          <Tooltip direction="top">Start: {start.label}</Tooltip>
        </Marker>
      </MapContainer>
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className="absolute right-2 top-2 z-[1000] rounded-md border border-ink/20 bg-white/95 px-2 py-1 text-xs font-medium text-ink shadow-sm hover:bg-white"
      >
        {satellite ? "Streets" : "Satellite"}
      </button>
    </div>
  )
}
