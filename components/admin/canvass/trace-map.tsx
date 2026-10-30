"use client"

/**
 * Satellite map centred on one parcel with its county outline. "Trace lawn" draws polygons (click to add corners,
 * double-click or Finish to close); each closed shape joins the trace, the area updates live, and "Save traced
 * turf" stores the FeatureCollection. Loaded only through trace-map-client.tsx (next/dynamic, ssr: false).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Eraser, Pencil, Save, Trash2, Undo2 } from "lucide-react"
import { MapContainer, Polygon } from "react-leaflet"
import { saveTurfTraceAction } from "@/app/admin/actions/canvass"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import type { LatLng } from "@/lib/canvass/admin-rows"
import { boundsOf, formatSqft, geomToLatLngs } from "@/lib/canvass/admin-rows"
import { tracedAreaSqft } from "@/lib/canvass/quote"
import type { GeoFeatureCollection, GeoPolygon, ParcelGeom } from "@/lib/canvass/types"
import { BaseLayers, BRAND_GREEN, FitBounds, useDrawPolygon } from "./map-shared"
import type { DrawPolygon } from "./map-shared"

export type TraceMapProps = {
  parcelId: string
  geom: ParcelGeom | null
  center: LatLng
  initialTrace: GeoFeatureCollection | null
  /** County-based estimate, shown next to the traced number. */
  estimateSqft: number | null
}

const TRACE_COLOR = "#2E7D32"

/** Every polygon in a stored trace (MultiPolygon features are split). */
function polygonsOf(fc: GeoFeatureCollection | null): GeoPolygon[] {
  if (!fc) return []
  const out: GeoPolygon[] = []
  for (const f of fc.features) {
    if (f.geometry.type === "Polygon") out.push(f.geometry)
    else for (const coords of f.geometry.coordinates) out.push({ type: "Polygon", coordinates: coords })
  }
  return out
}

const toCollection = (shapes: readonly GeoPolygon[]): GeoFeatureCollection => ({
  type: "FeatureCollection",
  features: shapes.map((geometry) => ({ type: "Feature", geometry, properties: null })),
})

export function TraceMap({ parcelId, geom, center, initialTrace, estimateSqft }: TraceMapProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [shapes, setShapes] = React.useState<GeoPolygon[]>(() => polygonsOf(initialTrace))
  const [dirty, setDirty] = React.useState(false)
  const drawRef = React.useRef<DrawPolygon | null>(null)
  const draw = useDrawPolygon({
    onFinish: (poly) => {
      setShapes((s) => [...s, poly])
      setDirty(true)
      drawRef.current?.clear()
    },
  })
  drawRef.current = draw
  const { MapEvents, DrawLayer } = draw

  const bounds = React.useMemo(() => (geom ? boundsOf([{ geom }]) : null), [geom])
  const outline = React.useMemo(() => (geom ? geomToLatLngs(geom) : null), [geom])
  const tracedSqft = React.useMemo(() => (shapes.length > 0 ? tracedAreaSqft(toCollection(shapes)) : 0), [shapes])
  const hadTrace = polygonsOf(initialTrace).length > 0

  const save = () => {
    startTransition(async () => {
      const r = await saveTurfTraceAction(parcelId, toCollection(shapes))
      toast(r.ok ? { title: r.message, variant: "success" } : { title: "Couldn't save the trace", description: r.reason, variant: "destructive" })
      if (r.ok) {
        setDirty(false)
        router.refresh()
      }
    })
  }

  const clearAll = () => {
    draw.clear()
    setShapes([])
    if (!hadTrace) {
      setDirty(false)
      return
    }
    startTransition(async () => {
      const r = await saveTurfTraceAction(parcelId, null)
      toast(r.ok ? { title: r.message, variant: "success" } : { title: "Couldn't clear the trace", description: r.reason, variant: "destructive" })
      if (r.ok) {
        setDirty(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {draw.drawing ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => draw.finish()} disabled={draw.vertices.length < 3}>
              <Save /> Finish shape
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={draw.undo} disabled={draw.vertices.length === 0}>
              <Undo2 /> Undo corner
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={draw.clear}>
              <Eraser /> Cancel
            </Button>
            <span className="text-xs text-ink-muted">
              {draw.vertices.length < 3 ? `Click the lawn's corners (${draw.vertices.length} of 3 needed)` : "Double-click or Finish to close this shape"}
            </span>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={draw.start} disabled={pending}>
              <Pencil /> {shapes.length > 0 ? "Add another shape" : "Trace lawn"}
            </Button>
            {shapes.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setShapes((s) => s.slice(0, -1))
                  setDirty(true)
                }}
              >
                <Undo2 /> Remove last shape
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={save} disabled={pending || shapes.length === 0 || !dirty}>
              {pending ? "Saving…" : "Save traced turf"}
            </Button>
            {shapes.length > 0 || hadTrace ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={pending}>
                <Trash2 /> Clear trace
              </Button>
            ) : null}
          </>
        )}
      </div>

      <div className="relative z-0 h-[22rem] overflow-hidden rounded-lg border border-ink/10 sm:h-[28rem]">
        <MapContainer center={center} zoom={19} maxZoom={20} scrollWheelZoom className="h-full w-full" style={{ background: "#E8E8E8" }}>
          <BaseLayers defaultLayer="satellite" />
          <FitBounds bounds={bounds} padding={16} maxZoom={20} />
          {outline ? <Polygon positions={outline} pathOptions={{ color: BRAND_GREEN, weight: 2.5, fill: false, dashArray: "2 4" }} /> : null}
          {shapes.map((s, i) => (
            <Polygon key={i} positions={geomToLatLngs(s)} pathOptions={{ color: TRACE_COLOR, weight: 2, fillColor: TRACE_COLOR, fillOpacity: 0.35 }} />
          ))}
          <DrawLayer color="#ffffff" />
          <MapEvents />
        </MapContainer>
      </div>

      <p className="text-sm text-ink">
        {shapes.length > 0 ? (
          <>
            Traced lawn <span className="font-semibold tabular-nums">{formatSqft(tracedSqft)} sqft</span> in {shapes.length} shape{shapes.length === 1 ? "" : "s"}
            {dirty ? <span className="text-ink-muted"> (not saved yet)</span> : null}
          </>
        ) : (
          <span className="text-ink-muted">No trace yet.</span>
        )}
        {estimateSqft !== null ? <span className="text-ink-muted"> County estimate {formatSqft(estimateSqft)} sqft.</span> : null}
      </p>
    </div>
  )
}
