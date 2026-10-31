import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { ParcelRow } from "@/lib/canvass/admin-rows"
import type { ScoreWeights } from "@/lib/canvass/types"
import { PointsPopover } from "./points-popover"

/**
 * The Top 25: one card per house, best first. Label (tap for the three-factor breakdown), full address, the plain
 * reason, and the featured quote. The whole card opens the detail page;
 * the label button sits above the link so a tap on it opens the breakdown instead. No probabilities anywhere.
 */
export function TopList({ rows, weights, moreMatching = 0 }: { rows: ParcelRow[]; weights?: ScoreWeights; moreMatching?: number }) {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-ink-muted">
        No house passes the filters right now. Turn one off above or open &quot;Show all&quot; below.
      </Card>
    )
  }
  return (
    <div className="space-y-2">
      <ol className="grid gap-2 lg:grid-cols-2">
        {rows.map((r, i) => (
          <li key={r.id}>
            <Card className="relative flex gap-3 p-3 transition-colors hover:bg-gray-light/40">
              <span className="w-6 shrink-0 pt-1 text-right text-sm font-semibold tabular-nums text-ink-muted" aria-hidden="true">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <PointsPopover
                    label={r.scoreLabel}
                    points={r.scorePoints}
                    breakdown={r.scoreBreakdown}
                    reason={r.scoreReason}
                    weights={weights}
                    className="relative z-10 inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-white px-2 py-0.5 text-sm font-medium text-ink shadow-sm hover:bg-gray-light"
                  />
                  {r.isCustomer ? <Badge variant="secondary">Customer</Badge> : null}
                  {r.owner_is_entity ? <Badge variant="outline">Entity owner</Badge> : null}
                  {r.do_not_knock ? <Badge variant="destructive">Do not knock</Badge> : null}
                </div>
                <p className="font-semibold leading-tight text-ink">
                  <Link href={`/admin/canvass/parcels/${r.id}`} className="underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline">
                    {r.fullAddress}
                  </Link>
                </p>
                {r.scoreReason ? <p className="text-sm text-ink-body">{r.scoreReason}</p> : null}
                <p className="text-sm text-ink-muted">
                  Quote <span className="font-medium text-ink">{r.quoteLabel}</span>
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      {moreMatching > 0 ? <p className="text-xs text-ink-muted">{moreMatching} more pass the filters. Open &quot;Show all&quot; below to see them.</p> : null}
    </div>
  )
}
