import { Card } from "@/components/ui/card"
import { Stat } from "@/components/ui/stat"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { HangerConversion } from "@/lib/canvass/hangers"
import { percent } from "@/lib/canvass/stats"
import type { KnockStatRow } from "@/lib/canvass/stats"

/** Knocks, answer rate and close rate overall, plus a few parcel counts. */
export function StatsCards({
  totals,
  parcels,
}: {
  totals: Omit<KnockStatRow, "id" | "name">
  parcels: { parcels: number; doNotKnock: number; customers: number }
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Knocks" value={totals.knocks} hint={`${totals.answers} answered`} />
      <Stat label="Answer rate" value={percent(totals.answerRate)} hint="Doors that opened" />
      <Stat label="Close rate" value={percent(totals.closeRate)} hint={`${totals.closes} booked of ${totals.answers} answered`} />
      <Stat label="Parcels" value={parcels.parcels} hint={`${parcels.customers} customers, ${parcels.doNotKnock} do not knock`} />
    </div>
  )
}

/** Knocks / answers / quotes / booked per knocker or per pitch, with n. */
export function KnockStatsTable({ title, rows, emptyText }: { title: string; rows: KnockStatRow[]; emptyText: string }) {
  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-ink/10 px-4 py-3 text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title.replace(/^By /, "")}</TableHead>
              <TableHead className="text-right">Knocks</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Answers</TableHead>
              <TableHead className="text-right">Answer rate</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Quotes</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Booked</TableHead>
              <TableHead className="text-right">Close rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id ?? "none"}>
                <TableCell className="font-medium text-ink">
                  {r.name}
                  <span className="ml-1.5 text-xs font-normal text-ink-muted">n={r.knocks}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.knocks}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.answers}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(r.answerRate)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.quotes}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.closes}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(r.closeRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

/** Unique scans, bookings and rate per street's hanger code. */
export function HangerConversionsTable({ rows }: { rows: HangerConversion[] }) {
  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-ink/10 px-4 py-3 text-sm font-semibold text-ink">Hanger conversions by street</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-muted">No hanger codes yet. Generate one on the Hangers tab.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Street</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead className="text-right">Booked</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="font-medium text-ink">{r.street}</TableCell>
                <TableCell className="font-mono text-xs tracking-wider">{r.code}</TableCell>
                <TableCell className="text-right tabular-nums">{r.scans}</TableCell>
                <TableCell className="text-right tabular-nums">{r.bookings}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(r.rate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
