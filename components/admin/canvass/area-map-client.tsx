"use client"

/** `next/dynamic` wrapper: Leaflet reads `window` on import, so the real map only loads in the browser. */
import dynamic from "next/dynamic"
import type { AreaMapProps } from "./area-map"

function MapLoading() {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="h-9 w-40 animate-pulse rounded-md bg-gray-light" />
      <div className="h-[26rem] animate-pulse rounded-lg border border-ink/10 bg-gray-light sm:h-[32rem]" />
    </div>
  )
}

export const AreaMapClient = dynamic<AreaMapProps>(() => import("./area-map").then((m) => m.AreaMap), { ssr: false, loading: MapLoading })
