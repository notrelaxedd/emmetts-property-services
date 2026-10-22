"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"
import { propertyMapUrls } from "@/lib/geo/map"

const BOX = "flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-ink/25 bg-gray-light/60 p-4 text-center text-sm text-ink-muted"

/** County aerial photo with parcel outlines and a pin on the customer's coordinates. */
export function PropertyMap({ lat, lng, parcelId }: { lat: number | null; lng: number | null; parcelId: string | null }) {
  const [failed, setFailed] = React.useState(false)
  if (lat === null || lng === null) {
    return (
      <div className={BOX} role="img" aria-label="No map">
        No location yet. It fills in when the address is geocoded, or enter Lat / Lng below.
      </div>
    )
  }
  const urls = propertyMapUrls(lat, lng)
  return (
    <div className="space-y-1.5">
      {failed ? (
        <div className={BOX} role="img" aria-label="Map unavailable">
          The county map service didn&apos;t load. Use the Google Maps link below.
        </div>
      ) : (
        <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-ink/15 bg-gray-light">
          {/* eslint-disable-next-line @next/next/no-img-element -- county ArcGIS export images, not optimisable */}
          <img
            src={urls.imagery}
            alt={`Aerial photo around ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailed(true)}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls.parcels} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
          <span
            className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-destructive shadow"
            aria-hidden="true"
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">Cuyahoga County GIS</span>
        </div>
      )}
      <p className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span>{parcelId ? `Parcel ${parcelId}` : "Parcel not looked up yet"}</span>
        <a href={urls.google} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
          Google Maps <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  )
}
