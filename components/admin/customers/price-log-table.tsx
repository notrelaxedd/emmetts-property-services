"use client"

import * as React from "react"
import Link from "next/link"
import { Trash2 } from "lucide-react"
import { deleteInteraction, setInteractionStatus } from "@/app/admin/actions/customers"
import { usd } from "@/app/admin/money/math"
import { INTERACTION_STATUSES, formatPhone } from "@/components/admin/customers/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

export type PriceLogRow = {
  id: string
  talked_on: string
  category: string
  price: number | null
  notes: string | null
  follow_up_on: string | null
  status: string
  customer?: { id: string; name: string; phone: string | null }
}

/** Price-log entries, newest first. Status is editable in place; follow-ups that are due are flagged. */
export function PriceLogTable({ rows, today }: { rows: PriceLogRow[]; today: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const showCustomer = rows.some((r) => r.customer)

  const done = (r: { ok: true; message?: string } | { ok: false; reason: string }) => {
    toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
  }

  const setStatus = (row: PriceLogRow, status: string) =>
    startTransition(async () => {
      done(await setInteractionStatus(row.id, status))
    })
  const remove = (row: PriceLogRow) => {
    const what = `${row.category}${row.price === null ? "" : ` (${usd(row.price)})`}`
    if (!window.confirm(`Delete the ${what} entry${row.customer ? ` for ${row.customer.name}` : ""}?`)) return
    startTransition(async () => {
      done(await deleteInteraction(row.id))
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden sm:table-cell">Date</TableHead>
          {showCustomer ? <TableHead>Customer</TableHead> : null}
          <TableHead>What about</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="hidden md:table-cell">Follow up</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Delete</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const due = r.status === "open" && r.follow_up_on !== null && r.follow_up_on <= today
          return (
            <TableRow key={r.id}>
              <TableCell className="hidden whitespace-nowrap sm:table-cell">{r.talked_on}</TableCell>
              {showCustomer ? (
                <TableCell>
                  {r.customer ? (
                    <>
                      <Link href={`/admin/customers/${r.customer.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {r.customer.name}
                      </Link>
                      {r.customer.phone ? (
                        <a href={`tel:${r.customer.phone}`} className="block whitespace-nowrap text-xs text-ink-muted hover:underline">
                          {formatPhone(r.customer.phone)}
                        </a>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              ) : null}
              <TableCell className="max-w-[20rem]">
                <Badge variant="outline">{r.category}</Badge>
                <p className="mt-1 text-xs text-ink-muted sm:hidden">{r.talked_on}</p>
                {r.follow_up_on ? (
                  <p className="mt-1 md:hidden">
                    {due ? <Badge variant="warning">Follow up {r.follow_up_on}</Badge> : <span className="text-xs text-ink-muted">Follow up {r.follow_up_on}</span>}
                  </p>
                ) : null}
                {r.notes ? (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-muted" title={r.notes}>
                    {r.notes}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-ink">{r.price === null ? "—" : usd(r.price)}</TableCell>
              <TableCell className="hidden whitespace-nowrap md:table-cell">
                {r.follow_up_on ? due ? <Badge variant="warning">Due {r.follow_up_on}</Badge> : r.follow_up_on : "—"}
              </TableCell>
              <TableCell className="min-w-[11rem]">
                <NativeSelect
                  aria-label="Status"
                  value={r.status}
                  disabled={pending}
                  onChange={(e) => setStatus(r, e.target.value)}
                  className="h-8"
                >
                  {INTERACTION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" className="size-8" disabled={pending} onClick={() => remove(r)}>
                  <Trash2 />
                  <span className="sr-only">Delete entry</span>
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
