"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ScoreLabel, SimpleScore } from "@/lib/canvass/simple-score"
import { scoreLabelText } from "@/lib/canvass/simple-score"
import type { ScoreWeights } from "@/lib/canvass/types"

type Factor = { key: keyof SimpleScore["breakdown"]; label: string; hint: string }

const FACTORS: Factor[] = [
  { key: "time", label: "Time", hint: "Good now 3, maybe 2, not home 0" },
  { key: "lawn", label: "Lawn", hint: "Small 1, medium 2, large 3" },
  { key: "customer", label: "Customer nearby", hint: "Next door 3, close 2, same street 1" },
  { key: "owner", label: "Owner", hint: "Owner-occupied 3, unknown 1, rental 0" },
]

const EMOJI: Record<ScoreLabel, string> = { hot: "🔥", good: "👍", low: "➖" }

/** "7 of 12": the points a house earned out of the most it can earn. */
export function pointsText(points: number, max = 12): string {
  return `${points} of ${max}`
}

/** The most one factor can add: 3 points times the owner's weight for it (shown as e.g. "2.4" for 0.8 x 3). */
export function factorMax(weight: number | null | undefined): number {
  const w = typeof weight === "number" && Number.isFinite(weight) ? Math.max(0, weight) : 1
  return Math.round(3 * w * 10) / 10
}

/**
 * The 🔥 / 👍 / ➖ label as a tap target. Opens the four-factor breakdown behind the label. Owner pages only: crew
 * surfaces never get points.
 */
export function PointsPopover({
  label,
  points,
  breakdown,
  reason,
  weights,
  max = 12,
  className,
}: {
  label: ScoreLabel
  points: number
  breakdown: SimpleScore["breakdown"]
  /** The reasons joined with " · ". */
  reason?: string
  weights?: ScoreWeights
  max?: number
  className?: string
}) {
  const text = scoreLabelText(label)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            className ??
            "inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-white px-2.5 py-1 text-sm font-medium text-ink shadow-sm hover:bg-gray-light"
          }
          aria-label={`${text}, ${pointsText(points, max)} points. Tap to see how it adds up`}
        >
          <span aria-hidden="true">{EMOJI[label]}</span>
          {text}
          <Info className="size-3.5 text-ink-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="font-semibold text-ink">
          {EMOJI[label]} {text}: {pointsText(points, max)} points
        </p>
        {reason ? <p className="mt-0.5 text-xs text-ink-muted">{reason}</p> : null}
        <dl className="mt-3 space-y-1.5">
          {FACTORS.map((f) => (
            <div key={f.key} className="flex items-baseline justify-between gap-3">
              <dt>
                <span className="text-ink">{f.label}</span>
                <span className="block text-xs text-ink-muted">{f.hint}</span>
              </dt>
              <dd className="whitespace-nowrap font-semibold tabular-nums text-ink">
                {breakdown[f.key]} <span className="text-xs font-normal text-ink-muted">/ {factorMax(weights?.[f.key])}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-ink/10 pt-2 text-xs text-ink-muted">Hot is 9 or more, good 5 to 8, low 4 or less. Weights are in Settings.</p>
      </PopoverContent>
    </Popover>
  )
}
