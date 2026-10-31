"use client"

/**
 * Shared Leaflet pieces for the Canvass maps. This module imports react-leaflet (and Leaflet's CSS), so it must
 * only be imported from components that are themselves loaded with `next/dynamic(..., { ssr: false })`
 * (area-map.tsx, trace-map.tsx, plan-map.tsx). Pages never import it directly.
 *
 * Tiles: OpenStreetMap (streets) and Esri World Imagery (satellite, overridable with NEXT_PUBLIC_SATELLITE_TILE_URL).
 * No marker icons anywhere (Leaflet's defaults load from a CDN): polygons, polylines and CircleMarkers only.
 */
import "leaflet/dist/leaflet.css"
import * as React from "react"
import { CircleMarker, LayersControl, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet"
import type { LatLng } from "@/lib/canvass/admin-rows"
import { scoreColor } from "@/lib/canvass/admin-rows"
import type { GeoPolygon, Position } from "@/lib/canvass/types"

export { scoreColor }

export const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const ESRI_IMAGERY_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
export const SAT_TILES = process.env.NEXT_PUBLIC_SATELLITE_TILE_URL || ESRI_IMAGERY_TILES
export const SAT_ATTRIBUTION =
  SAT_TILES === ESRI_IMAGERY_TILES ? "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community" : "Satellite imagery"

/** Leaflet's max for these tile sets; Esri imagery is sparse above 19 in places. */
export const MAX_ZOOM = 20

export const BRAND_GREEN = "#65C435"
export const BRAND_GREEN_DARK = "#327213"
export const INK = "#0B0B0B"

/** Leaflet's CSS is imported above; this is a no-op kept so callers can be explicit about it. */
export function LeafletCss() {
  return null
}

/** Streets / Satellite switcher. `defaultLayer` picks which one is on when the map opens. */
export function BaseLayers({ defaultLayer = "streets" }: { defaultLayer?: "streets" | "satellite" }) {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer name="Streets" checked={defaultLayer === "streets"}>
        <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite" checked={defaultLayer === "satellite"}>
        <TileLayer url={SAT_TILES} attribution={SAT_ATTRIBUTION} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
      </LayersControl.BaseLayer>
    </LayersControl>
  )
}

/** Fits the map to `bounds` once (and again whenever the bounds object changes identity). */
export function FitBounds({ bounds, padding = 24, maxZoom = 18 }: { bounds: [LatLng, LatLng] | null; padding?: number; maxZoom?: number }) {
  const map = useMap()
  React.useEffect(() => {
    if (!bounds) return
    const [[minLat, minLng], [maxLat, maxLng]] = bounds
    if (minLat === maxLat && minLng === maxLng) {
      map.setView([minLat, minLng], maxZoom)
      return
    }
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom })
  }, [map, bounds, padding, maxZoom])
  return null
}

const toLatLng = ([lng, lat]: Position): LatLng => [lat, lng]

/** Closes the ring (first vertex repeated last) and returns a GeoJSON Polygon, or null with fewer than 3 vertices. */
export function polygonFromVertices(vertices: readonly Position[]): GeoPolygon | null {
  if (vertices.length < 3) return null
  const ring = vertices.map(([lng, lat]) => [lng, lat] as Position)
  ring.push([ring[0][0], ring[0][1]])
  return { type: "Polygon", coordinates: [ring] }
}

/** Two clicks of a double-click land within this many degrees of each other (~1 m). */
const DUPLICATE_EPS = 0.00002

type DrawHandlers = { onClick: (p: Position) => void; onDblClick: () => void }

/** Wires map clicks to the drawing while `active`; also turns double-click zoom off so a double-click can finish. */
function DrawMapEvents({ active, handlers }: { active: boolean; handlers: React.MutableRefObject<DrawHandlers> }) {
  const map = useMapEvents({
    click: (e) => {
      if (active) handlers.current.onClick([e.latlng.lng, e.latlng.lat])
    },
    dblclick: () => {
      if (active) handlers.current.onDblClick()
    },
  })
  React.useEffect(() => {
    if (!active) return
    map.doubleClickZoom.disable()
    const container = map.getContainer()
    const prev = container.style.cursor
    container.style.cursor = "crosshair"
    return () => {
      map.doubleClickZoom.enable()
      container.style.cursor = prev
    }
  }, [map, active])
  return null
}

export type DrawPolygon = {
  /** Vertices in GeoJSON order ([lng, lat]). */
  vertices: Position[]
  /** The finished, closed polygon; null while drawing or before anything was drawn. */
  polygon: GeoPolygon | null
  drawing: boolean
  /** Clears and starts collecting clicks. */
  start: () => void
  /** Closes the ring (needs 3+ vertices) and returns the polygon; with fewer it keeps drawing and returns null. */
  finish: () => GeoPolygon | null
  /** Removes the last vertex while drawing. */
  undo: () => void
  clear: () => void
  /** Render inside the MapContainer: listens for clicks while drawing. */
  MapEvents: React.ComponentType
  /** Render inside the MapContainer: the vertices + outline being drawn, and the finished polygon. */
  DrawLayer: React.ComponentType<{ color?: string }>
}

/**
 * Click-to-add-vertex polygon drawing with no plugin: `start()`, click the map (a double-click or `finish()` closes
 * the ring), `clear()`. `onFinish` fires with each closed polygon (the trace map accumulates them).
 */
export function useDrawPolygon(opts: { onFinish?: (polygon: GeoPolygon) => void } = {}): DrawPolygon {
  const [vertices, setVertices] = React.useState<Position[]>([])
  const [drawing, setDrawing] = React.useState(false)
  const [polygon, setPolygon] = React.useState<GeoPolygon | null>(null)
  const onFinishRef = React.useRef(opts.onFinish)
  onFinishRef.current = opts.onFinish
  const verticesRef = React.useRef<Position[]>([])
  verticesRef.current = vertices

  const start = React.useCallback(() => {
    setVertices([])
    setPolygon(null)
    setDrawing(true)
  }, [])

  const clear = React.useCallback(() => {
    setVertices([])
    setPolygon(null)
    setDrawing(false)
  }, [])

  const finishWith = React.useCallback((vs: Position[]): GeoPolygon | null => {
    const poly = polygonFromVertices(vs)
    if (!poly) return null
    setPolygon(poly)
    setDrawing(false)
    onFinishRef.current?.(poly)
    return poly
  }, [])

  const finish = React.useCallback(() => finishWith(verticesRef.current), [finishWith])

  const undo = React.useCallback(() => setVertices((vs) => vs.slice(0, -1)), [])

  const handlers = React.useRef<DrawHandlers>({ onClick: () => {}, onDblClick: () => {} })
  handlers.current = {
    onClick: (p) => {
      setVertices((vs) => {
        const last = vs[vs.length - 1]
        if (last && Math.abs(last[0] - p[0]) < DUPLICATE_EPS && Math.abs(last[1] - p[1]) < DUPLICATE_EPS) return vs
        return [...vs, p]
      })
    },
    onDblClick: () => {
      // Leaflet fires click, click, dblclick: the second click is a near-duplicate, which onClick already dropped.
      finishWith(verticesRef.current)
    },
  }

  const MapEvents = React.useMemo(() => {
    const Events = () => <DrawMapEvents active={drawing} handlers={handlers} />
    Events.displayName = "DrawMapEvents"
    return Events
  }, [drawing])

  const DrawLayer = React.useMemo(() => {
    const Layer = ({ color = BRAND_GREEN_DARK }: { color?: string }) => {
      if (polygon && !drawing) {
        return <Polygon positions={polygon.coordinates[0].map(toLatLng)} pathOptions={{ color, weight: 2, fillOpacity: 0.12, dashArray: "6 4" }} />
      }
      if (vertices.length === 0) return null
      const pts = vertices.map(toLatLng)
      return (
        <>
          {pts.length > 1 ? <Polyline positions={pts} pathOptions={{ color, weight: 2, dashArray: "6 4" }} /> : null}
          {pts.map((p, i) => (
            <CircleMarker key={i} center={p} radius={i === 0 ? 6 : 4} pathOptions={{ color, fillColor: "#fff", fillOpacity: 1, weight: 2 }} />
          ))}
        </>
      )
    }
    Layer.displayName = "DrawLayer"
    return Layer
  }, [vertices, polygon, drawing])

  return { vertices, polygon, drawing, start, finish, undo, clear, MapEvents, DrawLayer }
}
