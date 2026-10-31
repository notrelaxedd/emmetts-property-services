"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Printer, QrCode } from "lucide-react"
import { createHangerCodeAction, setHangerActiveAction } from "@/app/admin/actions/hangers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { percent } from "@/lib/canvass/stats"
import type { StreetHangerRow, StreetTotals } from "@/lib/canvass/streets"

/** Streets from the pulled parcels with their hanger code, scans and bookings. */
export function StreetsTable({ rows, totals }: { rows: StreetHangerRow[]; totals: StreetTotals }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)

  const generate = (street: string) => {
    setBusy(street)
    void createHangerCodeAction(street)
      .then((r) => {
        toast(r.ok ? { title: r.message, variant: "success" } : { title: "Couldn't create a code", description: r.reason, variant: "destructive" })
        if (r.ok) router.refresh()
      })
      .finally(() => setBusy(null))
  }

  const toggle = (code: string, active: boolean) => {
    setBusy(code)
    void setHangerActiveAction(code, active)
      .then((r) => {
        toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't update", description: r.reason, variant: "destructive" })
        if (r.ok) router.refresh()
      })
      .finally(() => setBusy(null))
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Street</TableHead>
            <TableHead className="text-right">Parcels</TableHead>
            <TableHead>Code</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Scans</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Booked</TableHead>
            <TableHead className="text-right">Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.street}>
              <TableCell>
                <p className="font-medium text-ink">{r.street}</p>
                {r.block_group_geoid ? <p className="text-xs text-ink-muted">Block group {r.block_group_geoid}</p> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.parcels}</TableCell>
              <TableCell>
                {r.code ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold tracking-wider text-ink">{r.code.code}</span>
                    {r.code.active ? null : <Badge variant="outline">Paused</Badge>}
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/canvass/hangers/${encodeURIComponent(r.code.code)}/print`}>
                        <Printer /> Print
                      </Link>
                    </Button>
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                      <Switch
                        checked={r.code.active}
                        disabled={busy === r.code.code}
                        onCheckedChange={(c) => toggle(r.code!.code, c)}
                        aria-label={`${r.code.code} active`}
                      />
                      Active
                    </label>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy === r.street} onClick={() => generate(r.street)}>
                    <QrCode /> Generate code
                  </Button>
                )}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.scans}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.bookings}</TableCell>
              <TableCell className="text-right tabular-nums">{percent(r.rate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">
        {totals.streets} streets, {totals.parcels} parcels, {totals.withCode} with a code. {totals.scans} scans, {totals.bookings} booked (
        {percent(totals.rate)}).
      </p>
    </Card>
  )
}
