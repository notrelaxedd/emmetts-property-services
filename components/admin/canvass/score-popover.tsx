"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { percentLabel } from "@/lib/canvass/admin-rows"
import type { ScoreBreakdown } from "@/lib/canvass/types"

/** The priority score with its parts: P(answer) × P(convert) × expected job value × neighbour boost. */
export function ScorePopover({ score, breakdown, quintile }: { score: number; breakdown: ScoreBreakdown; quintile: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-white px-2.5 py-1 text-sm font-medium text-ink shadow-sm hover:bg-gray-light"
          aria-label="How the priority score is built"
        >
          Score {score.toFixed(1)}
          <span className="text-xs font-normal text-ink-muted">top {Math.round(((5 - quintile) / 5) * 100)}%</span>
          <Info className="size-3.5 text-ink-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="font-semibold text-ink">Priority score</p>
        <p className="mt-0.5 text-xs text-ink-muted">Chance they answer × chance they say yes × job value × neighbour boost.</p>
        <dl className="mt-3 space-y-1.5">
          <Row label="Answers the door" value={percentLabel(breakdown.pAnswer)} hint="In this house's window" />
          <Row label="Says yes" value={percentLabel(breakdown.pConvert)} hint="From past knocks on similar houses" />
          <Row label="Job value" value={`$${Math.round(breakdown.value)}`} hint="Mid of the season quote" />
          <Row label="Neighbour boost" value={`×${breakdown.neighborBoost.toFixed(1)}`} hint={breakdown.neighborBoost > 1 ? "A customer lives close by" : "No customer close by"} />
        </dl>
        <p className="mt-3 border-t border-ink/10 pt-2 text-xs text-ink-muted">Score {score.toFixed(2)}, quintile {quintile + 1} of 5 among loaded parcels.</p>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>
        <span className="text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}
