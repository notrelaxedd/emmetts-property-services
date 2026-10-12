"use client"

import * as React from "react"
import { markAllPaid, markPayoutPaid } from "@/app/admin/actions/employees"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

export type PayoutRow = {
  id: string
  jobLabel: string
  date: string | null
  hours: number
  rate: number
  amount: number
  paidAt: string | null
}

export function MarkAllPaidButton({ crewId, owed }: { crewId: string; owed: number }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      disabled={pending || owed <= 0}
      onClick={() => {
        if (!window.confirm(`Mark ${usd(owed)} as paid in cash?`)) return
        startTransition(async () => {
          const r = await markAllPaid(crewId)
          toast(r.ok ? { title: r.message ?? "Marked paid", variant: "success" } : { title: "Couldn't mark paid", description: r.reason, variant: "destructive" })
        })
      }}
    >
      Mark all paid
    </Button>
  )
}

export function PayoutsTable({ rows }: { rows: PayoutRow[] }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [busy, setBusy] = React.useState<string | null>(null)

  const pay = (id: string) => {
    setBusy(id)
    startTransition(async () => {
      const r = await markPayoutPaid(id)
      setBusy(null)
      toast(r.ok ? { title: r.message ?? "Marked paid", variant: "success" } : { title: "Couldn't mark paid", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Job</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="whitespace-nowrap">{p.date ?? "—"}</TableCell>
            <TableCell className="max-w-[18rem] truncate">{p.jobLabel}</TableCell>
            <TableCell className="text-right tabular-nums">{p.hours.toFixed(2)}</TableCell>
            <TableCell className="text-right tabular-nums">{usd(p.rate)}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums text-ink">{usd(p.amount)}</TableCell>
            <TableCell>
              {p.paidAt ? <Badge variant="success">Paid {p.paidAt}</Badge> : <Badge variant="warning">Owed</Badge>}
            </TableCell>
            <TableCell className="text-right">
              {!p.paidAt ? (
                <Button size="sm" variant="outline" disabled={pending && busy === p.id} onClick={() => pay(p.id)}>
                  Mark paid
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
