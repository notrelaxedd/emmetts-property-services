import { walkProgress } from "@/lib/canvass/walk-links"

export type ProgressBarProps = { total: number; handled: number; booked: number }

/** "8 of 25 · 2 booked" over a thin bar. */
export function ProgressBar({ total, handled, booked }: ProgressBarProps) {
  const p = walkProgress({ total, handled, booked })
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {p.label}
      </p>
      <div
        role="progressbar"
        aria-label="Walk progress"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.handled}
        aria-valuetext={p.label}
        className="h-2 overflow-hidden rounded-full bg-ink/10"
      >
        <div className="h-full rounded-full bg-brand-green transition-[width] duration-300" style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
    </div>
  )
}
