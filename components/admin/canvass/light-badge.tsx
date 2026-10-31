import { Clock3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { WINDOW_SOURCE_LABELS } from "@/lib/canvass/admin-rows"
import type { Light } from "@/lib/canvass/lights"
import { LIGHT_COLORS, LIGHT_LABELS } from "@/lib/canvass/lights"
import type { WindowResult } from "@/lib/canvass/types"
import { WeekStrip } from "./week-strip"
import type { StripDay } from "@/lib/canvass/lights"

export const LIGHT_EMOJI: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" }

/**
 * The knock-now light as a coloured dot plus words ("Good now", "Maybe", "Probably not home"), optionally with the
 * plain-English window after it, and the next good time when the light is red. Never a number. Colour is never the
 * only signal: the label is always in the text.
 */
export function LightBadge({
  light,
  label,
  plain,
  nextGoodTime,
  className,
}: {
  light: Light
  label?: string
  plain?: string
  /** Shown only on a red light ("Next good: today 4:30pm"); pass the KnockNow value as is. */
  nextGoodTime?: string | null
  className?: string
}) {
  return (
    <span className={className ?? "inline-flex flex-wrap items-center gap-x-1.5"}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-ink">
        <span className="inline-block size-2.5 rounded-full" style={{ background: LIGHT_COLORS[light] }} aria-hidden="true" />
        {label ?? LIGHT_LABELS[light]}
      </span>
      {plain ? <span className="text-ink-muted">{plain}</span> : null}
      {light === "red" && nextGoodTime !== undefined ? (
        <span className="text-ink-muted">{nextGoodTime ? `Next good: ${nextGoodTime}` : "No good time in the next 7 days"}</span>
      ) : null}
    </span>
  )
}

const SOURCE_VARIANT: Record<WindowResult["source"], "success" | "secondary" | "outline" | "warning"> = {
  homeowner: "success",
  crew: "success",
  learned: "secondary",
  acs: "outline",
  none: "warning",
}

/** The detail page's "Best time to knock" card: light now, the window in plain English, next good time, 7-day strip. */
export function WindowCard({
  light,
  lightLabel,
  nextGoodTime,
  plain,
  source,
  strip,
}: {
  light: Light
  lightLabel: string
  nextGoodTime: string | null
  plain: { text: string; reason: string }
  source: WindowResult["source"]
  strip: StripDay[]
}) {
  return (
    <Card className="space-y-3 p-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Clock3 className="size-3.5" aria-hidden="true" /> Best time to knock
      </p>
      <div>
        <p className="text-lg font-semibold leading-tight text-ink">
          <LightBadge light={light} label={lightLabel} />
        </p>
        {light !== "green" ? (
          <p className="mt-0.5 text-sm text-ink">{nextGoodTime ? `Next good time: ${nextGoodTime}` : "No good time in the next 7 days"}</p>
        ) : null}
      </div>
      <div>
        <p className="font-medium text-ink">{plain.text}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{plain.reason}</p>
        <Badge variant={SOURCE_VARIANT[source]} className="mt-2">
          {WINDOW_SOURCE_LABELS[source]}
        </Badge>
      </div>
      <WeekStrip strip={strip} />
    </Card>
  )
}
