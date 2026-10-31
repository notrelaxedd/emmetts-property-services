"use client"

/**
 * The area picker on /admin/canvass: pulled parcels as polygons coloured hot / good / low (do-not-knock red
 * dashed, customers blue outline), a click popup per parcel, and the draw-an-area tool that feeds "Pull parcels".
 * Loaded only through area-map-client.tsx (next/dynamic, ssr: false) because Leaflet touches `window` on import.
 */
import * as React from "react"
import { Eraser, MapPinned, Pencil, Undo2 } from "lucide-react"
import { MapContainer, Polygon, Popup } from "react-leaflet"
import type { LatLng, MapParcel, ParcelRow } from "@/lib/canvass/admin-rows"
import { boundsOf, CUSTOMER_COLOR, DO_NOT_KNOCK_COLOR, geomToLatLngs, outcomeLabel, scoreColor } from "@/lib/canvass/admin-rows"
import { LIGHT_EMOJI } from "./light-badge"
import { scoreLabelText } from "@/lib/canvass/simple-score"
import type { GeoPolygon } from "@/lib/canvass/types"
import { localDate } from "@/lib/scheduler/time"
import { Button } from "@/components/ui/button"
import { BaseLayers, FitBounds, useDrawPolygon } from "./map-shared"

export type AreaMapProps = {
  shapes: MapParcel[]
  /** Table rows by id, for the popup. */
  rows: ParcelRow[]
  center: LatLng
  pulling: boolean
  onPull: (polygon: GeoPolygon) => void
}

function ParcelPopup({ row }: { row: ParcelRow | undefined }) {
  if (!row) return null
  return (
    <div className="min-w-[12rem] space-y-1 text-sm text-ink">
      <p className="font-semibold leading-tight">{row.fullAddress}</p>
      <p className="text-xs text-ink-muted">{row.owner_display ?? "Owner unknown"}</p>
      <p>
        <span className="font-medium">
          {LIGHT_EMOJI[row.light]} {row.lightLabel}
        </span>
        <span className="block text-xs text-ink-muted">{row.plainText}</span>
        {row.light === "red" ? (
          <span className="block text-xs text-ink-muted">{row.nextGoodTime ? `Next good: ${row.nextGoodTime}` : "No good time in the next 7 days"}</span>
        ) : null}
      </p>
      <p>
        {row.scoreEmoji} {scoreLabelText(row.scoreLabel)}
        {row.scoreReason ? <span className="block text-xs text-ink-muted">{row.scoreReason}</span> : null}
      </p>
      <p>Quote {row.quoteLabel}</p>
      <p className="text-xs text-ink-muted">
        {row.lastKnockAt ? `Last knock ${localDate(new Date(row.lastKnockAt))}: ${outcomeLabel(row.lastOutcome)}` : "Not knocked yet"}
      </p>
      {row.do_not_knock ? <p className="text-xs font-semibold text-red-700">Do not knock</p> : null}
      {row.isCustomer ? <p className="text-xs font-semibold text-blue-700">Customer</p> : null}
      <a href={`/admin/canvass/parcels/${row.id}`} className="inline-block font-medium text-brand-green-dark underline-offset-4 hover:underline">
        Open
      </a>
    </div>
  )
}

function parcelStyle(p: MapParcel) {
  if (p.do_not_knock) return { color: DO_NOT_KNOCK_COLOR, weight: 1.5, dashArray: "4 3", fillColor: DO_NOT_KNOCK_COLOR, fillOpacity: 0.15 }
  const fill = scoreColor(p.label)
  if (p.isCustomer) return { color: CUSTOMER_COLOR, weight: 2.5, fillColor: fill, fillOpacity: 0.45 }
  return { color: "#ffffff", weight: 0.8, fillColor: fill, fillOpacity: 0.55 }
}

export function AreaMap({ shapes, rows, center, pulling, onPull }: AreaMapProps) {
  const draw = useDrawPolygon()
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const bounds = React.useMemo(() => boundsOf(shapes), [shapes])
  const { MapEvents, DrawLayer } = draw

  const polygons = React.useMemo(
    () =>
      shapes.map((p) => (
        <Polygon key={p.id} positions={geomToLatLngs(p.geom)} pathOptions={parcelStyle(p)}>
          <Popup>
            <ParcelPopup row={byId.get(p.id)} />
          </Popup>
        </Polygon>
      )),
    [shapes, byId],
  )

  const canPull = !!draw.polygon && !draw.drawing && !pulling

  // The pull tools live in a disclosure so the map and the Top 25 stay the page's focus. It opens by itself while an
  // area is being drawn or waits to be pulled.
  const [toolsOpen, setToolsOpen] = React.useState(false)
  const showTools = toolsOpen || draw.drawing || !!draw.polygon || pulling

  return (
    <div className="space-y-2">
      <details open={showTools} onToggle={(e) => setToolsOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-lg border border-ink/10 bg-white">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-ink">
          <MapPinned className="size-4" aria-hidden="true" /> Pull parcels
          <span className="text-xs font-normal text-ink-muted">draw an area to load its houses from the county</span>
        </summary>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 px-3 py-2">
        {draw.drawing ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => draw.finish()} disabled={draw.vertices.length < 3}>
              <MapPinned /> Finish area
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={draw.undo} disabled={draw.vertices.length === 0}>
              <Undo2 /> Undo
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={draw.clear}>
              <Eraser /> Cancel
            </Button>
            <span className="text-xs text-ink-muted">
              {draw.vertices.length < 3 ? `Click the map to add corners (${draw.vertices.length} of 3 needed)` : "Double-click or press Finish to close the area"}
            </span>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={draw.start} disabled={pulling}>
              <Pencil /> {draw.polygon ? "Redraw area" : "Draw area"}
            </Button>
            {draw.polygon ? (
              <Button type="button" variant="ghost" size="sm" onClick={draw.clear} disabled={pulling}>
                <Eraser /> Clear
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => draw.polygon && onPull(draw.polygon)} disabled={!canPull}>
              {pulling ? "Pulling…" : "Pull parcels"}
            </Button>
            {!draw.polygon ? <span className="text-xs text-ink-muted">Draw a few streets, then pull their parcels from the county.</span> : null}
          </>
        )}
      </div>
      </details>

      <div className="relative z-0 h-[26rem] overflow-hidden rounded-lg border border-ink/10 sm:h-[32rem]">
        <MapContainer center={center} zoom={15} maxZoom={20} scrollWheelZoom preferCanvas className="h-full w-full" style={{ background: "#E8E8E8" }}>
          <BaseLayers />
          <FitBounds bounds={bounds} />
          {polygons}
          <DrawLayer />
          <MapEvents />
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted" aria-label="Map legend">
        {(["hot", "good", "low"] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1">
            <span className="inline-block size-3 rounded-sm" style={{ background: scoreColor(l) }} aria-hidden="true" /> {scoreLabelText(l)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm border-2 border-dashed" style={{ borderColor: DO_NOT_KNOCK_COLOR }} aria-hidden="true" /> Do not knock
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm border-2" style={{ borderColor: CUSTOMER_COLOR }} aria-hidden="true" /> Customer
        </span>
      </div>
    </div>
  )
}
