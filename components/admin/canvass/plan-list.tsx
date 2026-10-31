import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { LightBadge } from "./light-badge"
import type { PlanView } from "@/lib/canvass/views"

/** "Skipped: 3 do-not-knock, 5 knocked recently, 12 outside the window" (only the non-zero parts). */
export function skippedLine(excluded: PlanView["excluded"]): string | null {
  const parts: string[] = []
  if (excluded.dnk > 0) parts.push(`${excluded.dnk} do-not-knock`)
  if (excluded.recent > 0) parts.push(`${excluded.recent} knocked recently`)
  if (excluded.noOverlap > 0) parts.push(`${excluded.noOverlap} outside the window`)
  return parts.length > 0 ? `Skipped: ${parts.join(", ")}` : null
}

function slotLabel(slot: PlanView["slot"]): string {
  const [y, m, d] = slot.date.split("-").map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
  return `${day}, ${slot.start} to ${slot.end}`
}

const km = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`)

/** The planned stops in walking order. Plain markup so "Print list" prints it as is. */
export function PlanList({ plan }: { plan: PlanView }) {
  const skipped = skippedLine(plan.excluded)
  return (
    <section id="plan-list" className="space-y-2 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-ink">
          {plan.stops.length} stop(s), {slotLabel(plan.slot)}
        </h2>
        <p className="text-sm text-ink-muted">
          {km(plan.totalMeters)} on foot, {plan.counts.candidates} house(s) in the window
        </p>
      </div>
      {skipped ? <p className="text-sm text-ink-muted">{skipped}</p> : null}
      {plan.stops.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">
          No house fits this slot. Try a later start, a different day, or pull more streets on the map.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead>Light and window</TableHead>
              <TableHead className="text-right">Quote</TableHead>
              <TableHead className="text-right">Walk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.stops.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-semibold tabular-nums text-ink">{s.order}</TableCell>
                <TableCell>
                  <div className="font-medium text-ink">{s.fullAddress}</div>
                  <div className="text-xs text-ink-muted md:hidden">{s.owner_display ?? "Resident"}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{s.owner_display ?? "Resident"}</TableCell>
                <TableCell>
                  <span title={s.plain.reason} className="block max-w-[16rem] text-sm">
                    <LightBadge light={s.knock.light} label={s.knock.label} plain={s.plain.text} nextGoodTime={s.knock.nextGoodTime} className="flex flex-col" />
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {s.quote.label}
                  {s.quote.underCost ? <span className="block text-xs font-semibold text-red-700">Under labor cost</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{s.walkMeters} m</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
