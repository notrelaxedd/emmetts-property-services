"use client"

import * as React from "react"
import { decideCrewException } from "@/app/admin/actions/availability"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { prettyDate, prettyRange } from "./shared"

export type PendingRequest = {
  id: string
  crewName: string
  kind: "off" | "extra"
  date_from: string
  date_to: string
  start_time: string | null
  end_time: string | null
  note: string | null
  created_at: string
}

export function PendingRequests({ rows }: { rows: PendingRequest[] }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const decide = (id: string, decision: "approved" | "declined") => {
    setBusyId(id)
    startTransition(async () => {
      const r = await decideCrewException(id, decision)
      setBusyId(null)
      toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: "Couldn't update the request", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Crew</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Hours</TableHead>
          <TableHead className="hidden md:table-cell">Note</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Decision</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium text-ink">{r.crewName}</TableCell>
            <TableCell>
              <Badge variant={r.kind === "off" ? "warning" : "secondary"}>{r.kind === "off" ? "Time off" : "Extra day"}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {prettyDate(r.date_from)}
              {r.date_to !== r.date_from ? ` – ${prettyDate(r.date_to)}` : ""}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {r.start_time && r.end_time ? prettyRange(r.start_time, r.end_time) : "All day"}
            </TableCell>
            <TableCell className="hidden max-w-[16rem] truncate md:table-cell">{r.note ?? "—"}</TableCell>
            <TableCell className="text-right">
              <span className="inline-flex gap-1.5">
                <Button size="sm" disabled={pending && busyId === r.id} onClick={() => decide(r.id, "approved")}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={pending && busyId === r.id} onClick={() => decide(r.id, "declined")}>
                  Decline
                </Button>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
