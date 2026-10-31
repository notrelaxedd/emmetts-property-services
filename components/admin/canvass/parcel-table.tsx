"use client"

/**
 * The parcel list under the area map: sortable columns, a text filter, a "hide do not knock" toggle and 50-row
 * pages. Rows are the slim `ParcelRow` shape (no polygons, no raw county attributes).
 */
import * as React from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ParcelRow } from "@/lib/canvass/admin-rows"
import { formatMoney, formatSqft, outcomeLabel, yesNo } from "@/lib/canvass/admin-rows"
import { localDate } from "@/lib/scheduler/time"
import type { ScoreWeights } from "@/lib/canvass/types"
import { cn } from "@/lib/utils"
import { LightBadge } from "./light-badge"
import { PointsPopover } from "./points-popover"

const PAGE_SIZE = 50
const col = createColumnHelper<ParcelRow>()

const makeColumns = (weights?: ScoreWeights) =>
  [
  col.accessor("fullAddress", {
    id: "address",
    header: "Address",
    cell: (c) => (
      <span className="block min-w-[10rem]">
        <Link href={`/admin/canvass/parcels/${c.row.original.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
          {c.getValue()}
        </Link>
        <span className="flex flex-wrap gap-1 text-xs text-ink-muted">
          {c.row.original.do_not_knock ? <Badge variant="destructive">Do not knock</Badge> : null}
          {c.row.original.isCustomer ? <Badge variant="secondary">Customer</Badge> : null}
          {c.row.original.owner_is_entity ? <Badge variant="outline">Entity owner</Badge> : null}
        </span>
      </span>
    ),
  }),
  col.accessor((r) => r.owner_display ?? "", {
    id: "owner",
    header: "Owner",
    meta: { className: "hidden md:table-cell" },
    cell: (c) => <span className="block max-w-[12rem] truncate">{c.getValue() || "?"}</span>,
  }),
  // Unknown values are read as undefined (not null): TanStack's sortUndefined only recognises undefined, and a null would sort as 0.
  col.accessor((r) => r.lot_sqft ?? undefined, {
    id: "lot_sqft",
    header: "Lot sqft",
    meta: { className: "hidden text-right lg:table-cell", align: "right" },
    sortUndefined: "last",
    cell: (c) => <span className="tabular-nums">{formatSqft(c.row.original.lot_sqft) || "?"}</span>,
  }),
  col.accessor((r) => r.turf_sqft ?? undefined, {
    id: "turf_sqft",
    header: "Turf sqft",
    meta: { className: "text-right", align: "right" },
    sortUndefined: "last",
    cell: (c) => (
      <span className="inline-flex items-center justify-end gap-1 tabular-nums">
        {formatSqft(c.row.original.turf_sqft) || "?"}
        {c.row.original.turfSource ? (
          <Badge variant={c.row.original.turfSource === "traced" ? "success" : "outline"} className="px-1.5 py-0 text-[10px]">
            {c.row.original.turfSource === "traced" ? "traced" : "est"}
          </Badge>
        ) : null}
      </span>
    ),
  }),
  col.accessor((r) => r.market_value ?? undefined, {
    id: "market_value",
    header: "Market value",
    meta: { className: "hidden text-right lg:table-cell", align: "right" },
    sortUndefined: "last",
    cell: (c) => <span className="tabular-nums">{formatMoney(c.row.original.market_value) || "?"}</span>,
  }),
  col.accessor((r) => r.owner_occupied ?? undefined, {
    id: "owner_occupied",
    header: "Owner occ.",
    meta: { className: "hidden text-center md:table-cell", align: "center" },
    sortUndefined: "last",
    cell: (c) => yesNo(c.row.original.owner_occupied),
  }),
  col.accessor("scorePoints", {
    id: "score",
    header: "Priority",
    cell: (c) => {
      const r = c.row.original
      return (
        <span className="block min-w-[10rem] space-y-0.5">
          <PointsPopover
            label={r.scoreLabel}
            points={r.scorePoints}
            breakdown={r.scoreBreakdown}
            reason={r.scoreReason}
            weights={weights}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-white px-2 py-0.5 text-sm font-medium text-ink hover:bg-gray-light"
          />
          {r.scoreReason ? <span className="block text-xs text-ink-muted">{r.scoreReason}</span> : null}
        </span>
      )
    },
  }),
  col.accessor("plainText", {
    id: "window",
    header: "Light and window",
    cell: (c) => {
      const r = c.row.original
      return (
        <span title={r.plainReason} className="block max-w-[14rem] text-sm">
          <LightBadge light={r.light} label={r.lightLabel} className="flex flex-col" plain={r.plainText} nextGoodTime={r.nextGoodTime} />
        </span>
      )
    },
  }),
  col.accessor("quoteLabel", {
    id: "quote",
    header: "Quote",
    meta: { className: "text-right", align: "right" },
    cell: (c) => {
      const r = c.row.original
      return (
        <span className="block whitespace-nowrap tabular-nums">
          {c.getValue()}
          {r.underCost ? <span className="block text-xs font-semibold text-red-700">Under labor cost</span> : null}
        </span>
      )
    },
  }),
  col.accessor((r) => r.lastOutcome ?? "", {
    id: "status",
    header: "Status",
    meta: { className: "hidden sm:table-cell" },
    cell: (c) => <span className="whitespace-nowrap">{outcomeLabel(c.row.original.lastOutcome)}</span>,
  }),
  col.accessor((r) => r.lastKnockAt ?? "", {
    id: "lastKnock",
    header: "Last knock",
    meta: { className: "hidden md:table-cell" },
    cell: (c) => {
      const r = c.row.original
      return <span className="whitespace-nowrap tabular-nums">{r.lastKnockAt ? `${localDate(new Date(r.lastKnockAt))}${r.knockCount > 1 ? ` (${r.knockCount})` : ""}` : "?"}</span>
    },
  }),
] as ColumnDef<ParcelRow, unknown>[]

type ColMeta = { className?: string; align?: "right" | "center" }

export function ParcelTable({ rows, weights }: { rows: ParcelRow[]; weights?: ScoreWeights }) {
  const columns = React.useMemo(() => makeColumns(weights), [weights])
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "score", desc: true }])
  const [filter, setFilter] = React.useState("")
  const [hideDnk, setHideDnk] = React.useState(true)

  const data = React.useMemo(() => (hideDnk ? rows.filter((r) => !r.do_not_knock) : rows), [rows, hideDnk])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _columnId, value: string) => {
      const q = value.trim().toLowerCase()
      if (!q) return true
      const r = row.original
      return [r.fullAddress, r.owner_display ?? "", r.street, r.parcel_id, r.plainText, r.scoreReason].some((s) => s.toLowerCase().includes(q))
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    autoResetPageIndex: true,
  })

  const total = table.getFilteredRowModel().rows.length
  const pageIndex = table.getState().pagination.pageIndex
  const from = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1
  const to = Math.min(total, (pageIndex + 1) * PAGE_SIZE)
  const dnkCount = rows.length - rows.filter((r) => !r.do_not_knock).length

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-3 py-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by address, owner or street"
          aria-label="Filter parcels"
          className="h-8 max-w-xs"
        />
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <Switch checked={hideDnk} onCheckedChange={setHideDnk} aria-label="Hide do-not-knock parcels" />
          Hide do not knock{dnkCount > 0 ? <span className="text-xs text-ink-muted">({dnkCount})</span> : null}
        </label>
        <span className="ml-auto text-xs text-ink-muted">
          {total === 0 ? "No parcels" : `${from}–${to} of ${total}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = (h.column.columnDef.meta ?? {}) as ColMeta
                  const sorted = h.column.getIsSorted()
                  return (
                    <TableHead key={h.id} className={cn("whitespace-nowrap", meta.className)}>
                      {h.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 font-medium hover:text-ink",
                            meta.align === "right" && "flex-row-reverse",
                            sorted && "text-ink",
                          )}
                          aria-label={`Sort by ${String(h.column.columnDef.header)}`}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-ink-muted">
                  {rows.length === 0 ? "No parcels pulled yet." : "Nothing matches that filter."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={cn(row.original.do_not_knock && "bg-red-50/60")}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as ColMeta
                    return (
                      <TableCell key={cell.id} className={cn("align-top", meta.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-3 py-2 text-sm">
          <Button type="button" variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft /> Previous
          </Button>
          <span className="text-xs text-ink-muted">
            Page {pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next <ChevronRight />
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
