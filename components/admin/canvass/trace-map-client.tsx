"use client"

/** `next/dynamic` wrapper for the lawn tracing map (Leaflet is browser-only). */
import dynamic from "next/dynamic"
import type { TraceMapProps } from "./trace-map"

function MapLoading() {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="h-9 w-32 animate-pulse rounded-md bg-gray-light" />
      <div className="h-[22rem] animate-pulse rounded-lg border border-ink/10 bg-gray-light sm:h-[28rem]" />
    </div>
  )
}

export const TraceMapClient = dynamic<TraceMapProps>(() => import("./trace-map").then((m) => m.TraceMap), { ssr: false, loading: MapLoading })
