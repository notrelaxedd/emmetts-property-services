import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { prettyRange, WEEK_ORDER, WEEKDAY_SHORT } from "./shared"

export type CrewBlocksRow = {
  id: string
  name: string
  paused: boolean
  maxHours: number
  blocks: { weekday: number; start_time: string; end_time: string }[]
}

/** Read-only weekly grid of every crew member's availability blocks. */
export function CrewBlocks({ rows }: { rows: CrewBlocksRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Crew</TableHead>
          {WEEK_ORDER.map((wd) => (
            <TableHead key={wd}>{WEEKDAY_SHORT[wd]}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap align-top">
              <p className="font-medium text-ink">{r.name}</p>
              <p className="text-xs text-ink-muted">max {r.maxHours}h/wk</p>
              {r.paused ? (
                <Badge variant="warning" className="mt-1">
                  Paused
                </Badge>
              ) : null}
            </TableCell>
            {WEEK_ORDER.map((wd) => {
              const day = r.blocks.filter((b) => b.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time))
              return (
                <TableCell key={wd} className="align-top">
                  {day.length === 0 ? (
                    <span className="text-xs text-ink-muted">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {day.map((b, i) => (
                        <li key={i} className="whitespace-nowrap rounded bg-brand-green/15 px-1.5 py-0.5 text-xs font-medium text-ink">
                          {prettyRange(b.start_time, b.end_time)}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
