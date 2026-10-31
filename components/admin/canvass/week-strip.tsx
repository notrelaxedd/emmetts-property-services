import type { Light, StripDay } from "@/lib/canvass/lights"
import { clockLabel, LIGHT_COLORS, LIGHT_LABELS } from "@/lib/canvass/lights"

/** Column headings, Mon..Sun (the strip's own order). */
export const STRIP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** The rows of the grid: every hour any day has a block for, earliest first (Sat/Sun start at 9, weekdays at 2pm). */
export function stripHours(strip: readonly StripDay[]): number[] {
  const hours = new Set<number>()
  for (const d of strip) for (const b of d.blocks) hours.add(b.hour)
  return Array.from(hours).sort((a, b) => a - b)
}

/** The light for one cell, or null when that day has no block at that hour (a weekday morning). */
export function cellLight(strip: readonly StripDay[], dayIndex: number, hour: number): Light | null {
  return strip[dayIndex]?.blocks.find((b) => b.hour === hour)?.light ?? null
}

/** "Monday 4pm: Good now" for the screen reader. */
export function cellLabel(dayIndex: number, hour: number, light: Light): string {
  return `${FULL_DAYS[dayIndex] ?? ""} ${clockLabel(hour)}: ${LIGHT_LABELS[light]}`
}

/** Seven columns, Mon..Sun, one coloured block per hour. Colours only: no numbers, no percentages. */
export function WeekStrip({ strip }: { strip: StripDay[] }) {
  const hours = stripHours(strip)
  if (hours.length === 0) return null
  return (
    <div>
      <div
        role="img"
        aria-label="This week at a glance: green is a good time to knock, yellow is maybe, red is probably not home"
        className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] gap-x-1 gap-y-0.5 text-[10px] text-ink-muted"
      >
        <span aria-hidden="true" />
        {STRIP_DAYS.map((d) => (
          <span key={d} className="text-center font-medium" aria-hidden="true">
            {d}
          </span>
        ))}
        {hours.map((h) => (
          <WeekStripRow key={h} hour={h} strip={strip} />
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
        {(["green", "yellow", "red"] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: LIGHT_COLORS[l] }} aria-hidden="true" />
            {LIGHT_LABELS[l]}
          </span>
        ))}
      </p>
    </div>
  )
}

function WeekStripRow({ hour, strip }: { hour: number; strip: StripDay[] }) {
  return (
    <>
      <span className="pr-1 text-right leading-5" aria-hidden="true">
        {clockLabel(hour)}
      </span>
      {STRIP_DAYS.map((_, i) => {
        const light = cellLight(strip, i, hour)
        return light ? (
          <span key={i} className="h-5 rounded-sm" style={{ background: LIGHT_COLORS[light] }} title={cellLabel(i, hour, light)} />
        ) : (
          <span key={i} className="h-5 rounded-sm bg-gray-light/60" aria-hidden="true" />
        )
      })}
    </>
  )
}
