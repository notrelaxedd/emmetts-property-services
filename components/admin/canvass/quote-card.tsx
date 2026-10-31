import Link from "next/link"
import { Settings2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatSqft } from "@/lib/canvass/admin-rows"
import type { SeasonFocus } from "@/lib/canvass/season"
import { SERVICE_KEYS, SERVICE_LABELS, TIER_LABELS } from "@/lib/canvass/types"
import type { Quote, ServiceKey } from "@/lib/canvass/types"
import type { CanvassSettings } from "@/lib/db/types"

export type QuoteCardProps = {
  season: SeasonFocus
  quote: Quote
  quotes: Record<ServiceKey, Quote>
  turfSqft: number | null
  turfSource: "traced" | "estimate" | null
  settings: Pick<CanvassSettings, "hardscape_pct" | "crew_size" | "pay_rate">
}

const dollars = (n: number): string => {
  const rounded = Math.round(n * 100) / 100
  return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`
}

/** "Labor $22.50 · Profit $17.50" for a priced quote with minutes filled in; "Add minutes in Settings" when not. */
export function profitText(q: Pick<Quote, "price" | "laborCost" | "profit">): string {
  if (q.price === null) return ""
  if (q.laborCost === null || q.profit === null) return "Labor minutes not set"
  const profit = q.profit < 0 ? `-${dollars(-q.profit)}` : dollars(q.profit)
  return `Labor ${dollars(q.laborCost)} · Profit ${profit}`
}

/** Under-labor-cost warning wording; null when the quote is fine (or cannot be judged). */
export function underCostText(q: Pick<Quote, "underCost" | "profit">): string | null {
  return q.underCost && q.profit !== null ? `Under labor cost by ${dollars(-q.profit)}` : null
}

/** The season service's price, then one price per service with profit and a red "Under labor cost" marker. Owner only. */
export function QuoteCard({ season, quote, quotes, turfSqft, turfSource, settings }: QuoteCardProps) {
  const warn = underCostText(quote)
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Door price, {season.label.toLowerCase()}</p>
        <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-ink">{quote.label}</p>
        {quote.tier ? <p className="mt-1 text-xs text-ink-muted">{TIER_LABELS[quote.tier]} lawn tier</p> : null}
        {warn ? (
          <p className="mt-1.5 inline-block rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{warn}</p>
        ) : null}
        <div className="mt-2 text-sm text-ink-muted">
          {turfSqft !== null ? (
            <>
              Lawn about {formatSqft(turfSqft)} sqft{" "}
              <Badge variant={turfSource === "traced" ? "success" : "outline"} className="align-middle">
                {turfSource === "traced" ? "traced" : "estimate"}
              </Badge>
              {turfSource === "traced"
                ? " from your trace."
                : ` from the county lot minus the house and ${Math.round(settings.hardscape_pct * 100)}% hardscape. Trace the lawn below for a tighter number.`}
            </>
          ) : (
            "Lot size unknown, so there is no tier to price from. Trace the lawn below."
          )}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="hidden sm:table-cell">Profit check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SERVICE_KEYS.map((k) => {
            const q = quotes[k]
            const under = underCostText(q)
            return (
              <TableRow key={k} className={k === season.service ? "bg-brand-green/10" : undefined}>
                <TableCell className="font-medium text-ink">
                  {SERVICE_LABELS[k]}
                  {k === season.service ? <span className="ml-1.5 text-xs font-normal text-ink-muted">this season</span> : null}
                  <span className="block text-xs font-normal text-ink-muted sm:hidden">{profitText(q)}</span>
                  {under ? <span className="block text-xs font-semibold text-red-700 sm:hidden">{under}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{q.label}</TableCell>
                <TableCell className="hidden text-xs text-ink-muted sm:table-cell">
                  {profitText(q)}
                  {under ? <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">{under}</span> : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 px-4 py-2 text-xs text-ink-muted">
        <span>
          One price per lawn tier. Labor is {settings.crew_size} crew at ${settings.pay_rate} an hour times the minutes you set.
        </span>
        <Link href="/admin/canvass/settings" className="inline-flex items-center gap-1 font-medium text-brand-green-dark underline-offset-4 hover:underline">
          <Settings2 className="size-3.5" aria-hidden="true" /> Pricing settings
        </Link>
      </p>
    </Card>
  )
}
