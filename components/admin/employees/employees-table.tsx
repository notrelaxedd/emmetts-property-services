"use client"

import * as React from "react"
import Link from "next/link"
import { updateEmployee } from "@/app/admin/actions/employees"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

export type EmployeeRow = {
  id: string
  name: string
  role: "owner" | "crew"
  phone: string | null
  email: string | null
  hourlyRate: number
  maxHoursWeek: number
  paused: boolean
  hoursThisWeek: number
  cashOwed: number
}

function Row({ e }: { e: EmployeeRow }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [rate, setRate] = React.useState(String(e.hourlyRate))
  const [maxHours, setMaxHours] = React.useState(String(e.maxHoursWeek))
  const dirty = Number(rate) !== e.hourlyRate || Number(maxHours) !== e.maxHoursWeek

  React.useEffect(() => {
    setRate(String(e.hourlyRate))
    setMaxHours(String(e.maxHoursWeek))
  }, [e.hourlyRate, e.maxHoursWeek])

  const save = (patch: { hourly_rate?: number; max_hours_week?: number; paused?: boolean }) =>
    startTransition(async () => {
      const r = await updateEmployee(e.id, patch)
      toast(r.ok ? { title: `${e.name}: ${r.message ?? "saved"}`, variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
    })

  return (
    <TableRow>
      <TableCell>
        <Link href={`/admin/employees/${e.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
          {e.name || "Unnamed"}
        </Link>
        <p className="text-xs text-ink-muted">{e.phone ?? e.email ?? ""}</p>
      </TableCell>
      <TableCell>
        <Badge variant={e.role === "owner" ? "default" : "outline"}>{e.role}</Badge>
      </TableCell>
      <TableCell>
        <Input
          aria-label={`${e.name} hourly rate`}
          type="number"
          min={0}
          step={0.25}
          value={rate}
          onChange={(ev) => setRate(ev.target.value)}
          className="h-8 w-20"
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`${e.name} max hours per week`}
          type="number"
          min={0}
          max={168}
          step={1}
          value={maxHours}
          onChange={(ev) => setMaxHours(ev.target.value)}
          className="h-8 w-20"
        />
      </TableCell>
      <TableCell>
        <Switch
          aria-label={`${e.name} paused`}
          checked={e.paused}
          disabled={pending}
          onCheckedChange={(paused) => save({ paused })}
        />
      </TableCell>
      <TableCell className="tabular-nums">{e.hoursThisWeek.toFixed(1)}h</TableCell>
      <TableCell className="tabular-nums">
        {e.cashOwed > 0 ? <span className="font-semibold text-ink">{usd(e.cashOwed)}</span> : <span className="text-ink-muted">{usd(0)}</span>}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty || pending || rate.trim() === "" || maxHours.trim() === ""}
          onClick={() => save({ hourly_rate: Number(rate), max_hours_week: Number(maxHours) })}
        >
          Save
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function EmployeesTable({ rows }: { rows: EmployeeRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Rate $/hr</TableHead>
          <TableHead>Max hrs/wk</TableHead>
          <TableHead>Paused</TableHead>
          <TableHead>This week</TableHead>
          <TableHead>Cash owed</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Save</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => (
          <Row key={e.id} e={e} />
        ))}
      </TableBody>
    </Table>
  )
}
