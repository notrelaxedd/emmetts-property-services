"use client"

import * as React from "react"
import Link from "next/link"
import { restoreFlyerWorker } from "@/app/admin/actions/flyers"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { percent, type FlyerFunnel } from "@/lib/flyers/stats"
import { perFlyer } from "./format"

export type FlyerWorkerRow = {
  id: string
  name: string
  phone: string | null
  code: string
  rate: number
  removed: boolean
  funnel: FlyerFunnel
}

function RestoreButton({ id, name }: { id: string; name: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await restoreFlyerWorker(id)
          toast(r.ok ? { title: `${name}: ${r.message ?? "restored"}`, variant: "success" } : { title: "Couldn't restore", description: r.reason, variant: "destructive" })
        })
      }
    >
      Restore
    </Button>
  )
}

const num = (n: number) => n.toLocaleString()

export function FlyerWorkersTable({ rows }: { rows: FlyerWorkerRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Flyers out</TableHead>
          <TableHead className="text-right">Scans</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Booked</TableHead>
          <TableHead className="text-right">Conversion</TableHead>
          <TableHead className="text-right">Owed</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          {rows.some((r) => r.removed) ? (
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((w) => (
          <TableRow key={w.id}>
            <TableCell>
              <Link href={`/admin/employees/flyers/${w.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                {w.name}
              </Link>
              <p className="text-xs text-ink-muted">
                <Badge variant="outline" className="mr-1 font-mono">
                  {w.code}
                </Badge>
                {perFlyer(w.rate)}/flyer
              </p>
            </TableCell>
            <TableCell className="text-right tabular-nums">{num(w.funnel.flyersOut)}</TableCell>
            <TableCell className="text-right tabular-nums">{num(w.funnel.scans)}</TableCell>
            <TableCell className="text-right tabular-nums">{num(w.funnel.requests)}</TableCell>
            <TableCell className="text-right tabular-nums">{num(w.funnel.booked)}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums text-ink">{percent(w.funnel.conversion)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {w.funnel.owed > 0 ? <span className="font-semibold text-ink">{usd(w.funnel.owed)}</span> : <span className="text-ink-muted">{usd(0)}</span>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{usd(w.funnel.paid)}</TableCell>
            {w.removed ? (
              <TableCell className="text-right">
                <RestoreButton id={w.id} name={w.name} />
              </TableCell>
            ) : rows.some((r) => r.removed) ? (
              <TableCell />
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
