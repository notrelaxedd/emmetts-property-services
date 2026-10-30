import Link from "next/link"
import { Settings2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatQuote, formatSqft } from "@/lib/canvass/admin-rows"
import type { SeasonFocus } from "@/lib/canvass/season"
import { SERVICE_KEYS, SERVICE_LABELS } from "@/lib/canvass/types"
import type { QuoteRange, ServiceKey } from "@/lib/canvass/types"
import type { CanvassSettings } from "@/lib/db/types"

export type QuoteCardProps = {
  season: SeasonFocus
  quote: QuoteRange
  quotes: Record<ServiceKey, QuoteRange>
  turfSqft: number | null
  turfSource: "traced" | "estimate" | null
  settings: Pick<CanvassSettings, "rate_per_1000_sqft" | "min_charge" | "hardscape_pct">
}

/** The season-focus door quote range, then every service, and where the lawn size came from. */
export function QuoteCard({ season, quote, quotes, turfSqft, turfSource, settings }: QuoteCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Door quote, {season.label.toLowerCase()}</p>
        <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-ink">{formatQuote(quote.low, quote.high)}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {turfSqft !== null ? (
            <>
              Lawn about {formatSqft(turfSqft)} sqft{" "}
              <Badge variant={turfSource === "traced" ? "success" : "outline"} className="align-middle">
                {turfSource === "traced" ? "traced" : "estimate"}
              </Badge>
              {turfSource === "traced" ? " from your trace." : ` from the county lot minus the house and ${Math.round(settings.hardscape_pct * 100)}% hardscape. Trace the lawn below for a tighter number.`}
            </>
          ) : (
            "Lot size unknown, so this is the minimum charge. Trace the lawn below to price it."
          )}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Range</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SERVICE_KEYS.map((k) => (
            <TableRow key={k} className={k === season.service ? "bg-brand-green/10" : undefined}>
              <TableCell className="font-medium text-ink">
                {SERVICE_LABELS[k]}
                {k === season.service ? <span className="ml-1.5 text-xs font-normal text-ink-muted">this season</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatQuote(quotes[k].low, quotes[k].high)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 px-4 py-2 text-xs text-ink-muted">
        <span>
          Base price plus ${settings.rate_per_1000_sqft} per 1,000 sqft, minimum ${settings.min_charge}. {quote.basis}
        </span>
        <Link href="/admin/canvass/settings" className="inline-flex items-center gap-1 font-medium text-brand-green-dark underline-offset-4 hover:underline">
          <Settings2 className="size-3.5" aria-hidden="true" /> Pricing settings
        </Link>
      </p>
    </Card>
  )
}
