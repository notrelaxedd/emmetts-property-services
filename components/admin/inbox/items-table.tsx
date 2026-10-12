"use client"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { QuoteItem, QuoteItemStatus } from "@/lib/db/types"
import { hours, label, money } from "./format"

const STATUS_VARIANT: Record<QuoteItemStatus, "secondary" | "success" | "warning" | "outline" | "destructive"> = {
  auto: "secondary",
  priced: "success",
  needs_owner: "warning",
  referred: "outline",
  declined: "outline",
}

export function ItemStatusBadge({ status }: { status: QuoteItemStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status === "auto" ? "Auto" : label(status)}</Badge>
}

/** Read-only line items: description, crew, hours, price (+ status for custom / resolved items). */
export function ItemsTable({ items, highlightId }: { items: QuoteItem[]; highlightId?: string }) {
  if (!items.length) return <p className="text-sm text-ink-muted">No line items.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Crew</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Price</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow key={i.id} className={i.id === highlightId ? "bg-violet-50" : undefined}>
            <TableCell>
              <span className="text-ink">{i.description}</span>
              {i.is_custom || i.status !== "auto" ? (
                <span className="ml-2 inline-flex">
                  <ItemStatusBadge status={i.status} />
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{i.crew_size}</TableCell>
            <TableCell className="text-right tabular-nums">{hours(i.est_hours)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(i.price)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
