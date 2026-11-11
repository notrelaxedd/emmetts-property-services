"use client"

import * as React from "react"
import Link from "next/link"
import { payAllOwed, payCommission, undoCommissionPayout } from "@/app/admin/actions/sales-reps"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import type { CommissionRow, CommissionStatus } from "@/lib/commissions/stats"
import { cn } from "@/lib/utils"

type Result = { ok: true; message?: string } | { ok: false; reason: string }

function useResultToast() {
  const { toast } = useToast()
  return (r: Result, failTitle: string) =>
    toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: failTitle, description: r.reason, variant: "destructive" })
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "—"

const JOB_LABEL: Record<string, string> = {
  quoting: "Being quoted",
  unscheduled: "Needs a day",
  proposed: "Proposed",
  crew_confirmed: "Crew confirmed",
  booked: "Booked",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
  lost: "Lost",
  spam: "Spam",
  deleted: "Job deleted",
}

export function CommissionBadge({ row }: { row: CommissionRow }) {
  switch (row.status) {
    case "paid":
      return <Badge variant="success">Paid {day(row.paidAt)}</Badge>
    case "owed":
      return <Badge variant="warning">Not paid yet</Badge>
    case "pending":
      return <Badge variant="outline">Job not done</Badge>
    default:
      return <Badge variant="secondary">No commission</Badge>
  }
}

/** Paid ↔ not paid for one job. */
function PaidToggle({ row }: { row: CommissionRow }) {
  const show = useResultToast()
  const [pending, startTransition] = React.useTransition()
  if (row.status === "none" || (!row.jobId && !row.payoutId)) return null

  if (row.payoutId) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Mark the ${usd(row.commission)} for ${row.customer} as not paid?`)) return
          startTransition(async () => {
            show(await undoCommissionPayout(row.payoutId!), "Couldn't undo")
          })
        }}
      >
        Mark not paid
      </Button>
    )
  }
  if (!row.jobId || row.price === null) return null
  const early = row.status === "pending"
  return (
    <Button
      size="sm"
      variant={early ? "ghost" : "outline"}
      disabled={pending}
      onClick={() => {
        if (early && !window.confirm(`This job isn't done yet. Pay the ${usd(row.commission)} now anyway?`)) return
        startTransition(async () => {
            show(await payCommission(row.jobId!, { early }), "Couldn't mark paid")
          })
      }}
    >
      {early ? "Pay early" : "Mark paid"}
    </Button>
  )
}

export function PayAllOwedButton({ repId, owed, name }: { repId: string; owed: number; name: string }) {
  const show = useResultToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      size="sm"
      disabled={pending || owed <= 0}
      onClick={() => {
        if (!window.confirm(`Mark ${usd(owed)} paid to ${name} for every finished job?`)) return
        startTransition(async () => {
            show(await payAllOwed(repId), "Couldn't mark paid")
          })
      }}
    >
      {owed > 0 ? `Pay all ${usd(owed)}` : "Nothing owed"}
    </Button>
  )
}

type Filter = "all" | CommissionStatus

/** Every job a rep sold: price, their commission, and paid / not paid. */
export function RepJobsTable({ rows, ratePercent }: { rows: CommissionRow[]; ratePercent: string }) {
  const [filter, setFilter] = React.useState<Filter>("all")
  const count = (s: CommissionStatus) => rows.filter((r) => r.status === s).length
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter)

  if (!rows.length) return <p className="px-4 py-3 text-sm text-ink-muted">No jobs yet. Jobs they book on /door show up here.</p>

  return (
    <div className="space-y-2">
      <FilterChips
        className="px-4"
        aria-label="Commission status"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        chips={[
          { value: "all", label: "All", count: rows.length },
          { value: "owed", label: "Not paid yet", count: count("owed") },
          { value: "pending", label: "Job not done", count: count("pending") },
          { value: "paid", label: "Paid", count: count("paid") },
        ]}
      />
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">Nothing here.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead className="hidden md:table-cell">Job date</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">{ratePercent}</TableHead>
              <TableHead>Paid?</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.key} className={cn(r.status === "none" && "opacity-60")}>
                <TableCell className="min-w-[10rem]">
                  {r.leadId ? (
                    <Link href={`/admin/leads/${r.leadId}`} className="font-medium text-ink underline-offset-4 hover:underline">
                      {r.customer}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{r.customer}</span>
                  )}
                  {r.address ? <div className="max-w-[16rem] truncate text-xs text-ink-muted">{r.address}</div> : null}
                  {r.services.length ? <div className="max-w-[16rem] truncate text-xs text-ink-muted">{r.services.join(", ")}</div> : null}
                  <div className="text-xs text-ink-muted sm:hidden">
                    {JOB_LABEL[r.jobStatus] ?? r.jobStatus} · {day(r.completedAt ?? r.jobDate)}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">{day(r.completedAt ?? r.jobDate)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="whitespace-nowrap text-sm">{JOB_LABEL[r.jobStatus] ?? r.jobStatus}</div>
                  <div className="whitespace-nowrap text-xs text-ink-muted">{r.customerPaid ? "Customer paid" : "Customer hasn't paid"}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.price === null ? "—" : usd(r.price)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-ink">
                  {r.price === null && r.status !== "paid" ? "—" : usd(r.commission)}
                  {r.priceChanged ? <div className="text-xs font-normal text-ink-muted">price changed since</div> : null}
                </TableCell>
                <TableCell>
                  <CommissionBadge row={r} />
                </TableCell>
                <TableCell className="text-right">
                  <PaidToggle row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
