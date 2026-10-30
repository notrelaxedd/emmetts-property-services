import { Clock3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { WINDOW_SOURCE_LABELS } from "@/lib/canvass/admin-rows"
import type { WindowResult } from "@/lib/canvass/types"

const SOURCE_VARIANT: Record<WindowResult["source"], "success" | "secondary" | "outline" | "warning"> = {
  homeowner: "success",
  crew: "success",
  learned: "secondary",
  acs: "outline",
  none: "warning",
}

/** The best time to knock, where that came from and why. Always a range, never a minute. */
export function WindowBadge({ window, compact = false }: { window: WindowResult; compact?: boolean }) {
  if (compact) {
    return (
      <span title={window.reason} className="inline-flex items-center gap-1.5">
        <Clock3 className="size-3.5 text-ink-muted" aria-hidden="true" />
        <span className="font-medium text-ink">{window.label}</span>
        <Badge variant={SOURCE_VARIANT[window.source]} className="px-1.5 py-0 text-[10px]">
          {WINDOW_SOURCE_LABELS[window.source]}
        </Badge>
      </span>
    )
  }
  return (
    <Card className="p-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Clock3 className="size-3.5" aria-hidden="true" /> Best time to knock
      </p>
      <p className="mt-1 text-lg font-semibold leading-tight text-ink">{window.label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={SOURCE_VARIANT[window.source]}>{WINDOW_SOURCE_LABELS[window.source]}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{window.reason}</p>
    </Card>
  )
}
