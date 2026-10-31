"use client"

import { ExternalLink, SkipForward } from "lucide-react"
import { LIGHT_COLORS, LIGHT_LABELS } from "@/lib/canvass/lights"
import type { WalkStopView } from "@/lib/canvass/views"
import { googleMapsWalkUrl, greetingFor, quoteLine } from "@/lib/canvass/walk-links"

export type NextCardProps = {
  stop: WalkStopView
  /** The pitch line: the crew member's chosen pitch script, else the season one-liner. */
  pitch: string
  serviceLabel: string
  onSkip: () => void
  /** More than one house left (skipping the last one would only land on it again). */
  canSkip: boolean
}

/** The house in front of the crew: "#8 · address", greeting, pitch, price, Google Maps link, Skip. No profit, labor or points. */
export function NextCard({ stop, pitch, serviceLabel, onSkip, canSkip }: NextCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold leading-snug text-ink">
          #{stop.order} · {stop.fullAddress}
        </h2>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-muted">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: LIGHT_COLORS[stop.light] }} />
          {LIGHT_LABELS[stop.light]}
        </span>
      </div>
      <p className="text-[0.9375rem] font-semibold text-ink">{greetingFor(stop.ownerFirstName)}</p>
      {pitch ? <p className="text-sm text-ink">{pitch}</p> : null}
      <p className="text-sm font-semibold text-brand-green-dark">{quoteLine(stop.quoteLabel, serviceLabel)}</p>
      {stop.callback_window ? <p className="text-xs text-ink-muted">Asked us to come back: {stop.callback_window}</p> : null}
      <div className="flex items-center gap-2">
        <a
          href={googleMapsWalkUrl(stop.lat, stop.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink/20 bg-white px-3 text-sm font-semibold text-ink hover:bg-ink/[0.04]"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open in Google Maps
        </a>
        <button
          type="button"
          onClick={onSkip}
          disabled={!canSkip}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ink/20 bg-white px-4 text-sm font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40"
        >
          <SkipForward className="size-4" aria-hidden="true" />
          Skip
        </button>
      </div>
    </div>
  )
}
