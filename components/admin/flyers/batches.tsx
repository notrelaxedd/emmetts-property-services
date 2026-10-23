"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { deleteFlyerBatch, logFlyerBatch, markAllFlyerBatchesPaid, markFlyerBatchPaid } from "@/app/admin/actions/flyers"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { perFlyer } from "./format"

export type BatchRow = {
  id: string
  date: string
  area: string | null
  count: number
  rate: number
  amount: number
  paidAt: string | null
}

type Result = { ok: true; message?: string } | { ok: false; reason: string }

function useResultToast() {
  const { toast } = useToast()
  return (r: Result, failTitle: string) =>
    toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: failTitle, description: r.reason, variant: "destructive" })
}

/** Log flyers handed to this worker. The rate starts at their default and can be changed per batch. */
export function LogBatchForm({ workerId, defaultRate, today }: { workerId: string; defaultRate: number; today: string }) {
  const show = useResultToast()
  const [pending, startTransition] = React.useTransition()
  const [date, setDate] = React.useState(today)
  const [count, setCount] = React.useState("")
  const [rate, setRate] = React.useState(String(defaultRate))
  const [area, setArea] = React.useState("")

  React.useEffect(() => setRate(String(defaultRate)), [defaultRate])
  const amount = Math.round(Number(count || 0) * Number(rate || 0) * 100) / 100

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await logFlyerBatch(workerId, { date, count: Number(count), rate: Number(rate), area: area.trim() || null })
      show(r, "Couldn't log the batch")
      if (r.ok) {
        setCount("")
        setArea("")
        setRate(String(defaultRate))
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_8rem_8rem_1fr_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="b-date">Handed out on</Label>
        <Input id="b-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-count">Flyers</Label>
        <Input id="b-count" type="number" inputMode="numeric" min={1} max={100000} step={1} value={count} onChange={(e) => setCount(e.target.value)} required placeholder="200" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-rate">Pay per flyer ($)</Label>
        <Input id="b-rate" type="number" inputMode="decimal" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-area">Area (optional)</Label>
        <Input id="b-area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} placeholder="Lakewood, west of Warren Rd" autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending || !count}>
        <Plus /> {pending ? "Logging…" : `Log ${count ? usd(amount) : "batch"}`}
      </Button>
    </form>
  )
}

export function MarkAllFlyersPaidButton({ workerId, owed }: { workerId: string; owed: number }) {
  const show = useResultToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      disabled={pending || owed <= 0}
      onClick={() => {
        if (!window.confirm(`Mark ${usd(owed)} as paid?`)) return
        startTransition(async () => {
          show(await markAllFlyerBatchesPaid(workerId), "Couldn't mark paid")
        })
      }}
    >
      Mark all paid
    </Button>
  )
}

export function BatchesTable({ rows }: { rows: BatchRow[] }) {
  const show = useResultToast()
  const [pending, startTransition] = React.useTransition()
  const [busy, setBusy] = React.useState<string | null>(null)

  const run = (id: string, action: () => Promise<Result>, failTitle: string) => {
    setBusy(id)
    startTransition(async () => {
      const r = await action()
      setBusy(null)
      show(r, failTitle)
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Area</TableHead>
          <TableHead className="text-right">Flyers</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="whitespace-nowrap">{b.date}</TableCell>
            <TableCell className="max-w-[16rem] truncate">{b.area || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{b.count.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{perFlyer(b.rate)}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums text-ink">{usd(b.amount)}</TableCell>
            <TableCell>{b.paidAt ? <Badge variant="success">Paid {b.paidAt}</Badge> : <Badge variant="warning">Owed</Badge>}</TableCell>
            <TableCell className="text-right">
              {!b.paidAt ? (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" disabled={pending && busy === b.id} onClick={() => run(b.id, () => markFlyerBatchPaid(b.id), "Couldn't mark paid")}>
                    Mark paid
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending && busy === b.id}
                    onClick={() => {
                      if (window.confirm(`Delete this batch of ${b.count.toLocaleString()} flyers?`)) run(b.id, () => deleteFlyerBatch(b.id), "Couldn't delete")
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
