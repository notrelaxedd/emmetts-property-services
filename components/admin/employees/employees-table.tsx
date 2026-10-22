"use client"

import * as React from "react"
import Link from "next/link"
import { removeEmployee, restoreEmployee, setTemporaryPassword, updateEmployee } from "@/app/admin/actions/employees"
import { usd } from "@/app/admin/money/math"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  removed?: boolean
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

  const result = (r: Awaited<ReturnType<typeof removeEmployee>>, failTitle: string) => {
    toast(r.ok ? { title: `${e.name || "Team member"}: ${r.message ?? "done"}`, variant: "success" } : { title: failTitle, description: r.reason, variant: "destructive" })
    return r.ok
  }
  const restore = () =>
    startTransition(async () => {
      result(await restoreEmployee(e.id), "Couldn't restore")
    })
  const [temp, setTemp] = React.useState<{ password: string; email: string } | null>(null)
  const setPassword = async () => {
    const r = await setTemporaryPassword(e.id)
    if (r.ok) setTemp({ password: r.password, email: r.email })
    else toast({ title: "Couldn't set a password", description: r.reason, variant: "destructive" })
    return r.ok
  }

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
        <div className="flex justify-end gap-1">
          {e.removed ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={restore}>
              Restore
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant={dirty ? "default" : "ghost"}
                disabled={!dirty || pending || rate.trim() === "" || maxHours.trim() === ""}
                onClick={() => save({ hourly_rate: Number(rate), max_hours_week: Number(maxHours) })}
              >
                Save
              </Button>
              {e.role === "owner" || !e.email ? null : (
                <ConfirmDialog
                  trigger="Set password"
                  triggerVariant="ghost"
                  title={`Set a temporary password for ${e.name || "this team member"}?`}
                  description={`They sign in at /login with ${e.email} and the password shown next. It replaces any password they had; they can change it any time from the crew app.`}
                  confirmLabel="Set password"
                  onConfirm={setPassword}
                />
              )}
              {e.role === "owner" ? null : (
                <ConfirmDialog
                  trigger="Remove"
                  triggerVariant="ghost"
                  title={`Remove ${e.name || "this team member"}?`}
                  description="They'll be taken off any upcoming jobs and lose access. Past payouts stay on record."
                  confirmLabel="Remove"
                  confirmVariant="default"
                  onConfirm={async () => result(await removeEmployee(e.id), "Couldn't remove")}
                />
              )}
            </>
          )}
        </div>
        <Dialog open={temp !== null} onOpenChange={(open) => (open ? null : setTemp(null))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Temporary password for {e.name || "this team member"}</DialogTitle>
              <DialogDescription>
                Text it to them now. It is shown only once; set another if it gets lost.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-left text-sm">
              <p>
                Email: <span className="font-medium text-ink">{temp?.email}</span>
              </p>
              <p className="rounded-md border border-ink/10 bg-paper px-3 py-2 font-mono text-lg tracking-wide text-ink" data-testid="temp-password">
                {temp?.password}
              </p>
              <p className="text-ink-muted">
                Sign in at <span className="font-medium text-ink">eodlawns.com/login</span> with the password tab.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => temp && navigator.clipboard?.writeText(`Sign in at https://www.eodlawns.com/login\nEmail: ${temp.email}\nPassword: ${temp.password}`).then(() => toast({ title: "Copied", variant: "success" }))}
              >
                Copy
              </Button>
              <Button type="button" onClick={() => setTemp(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            <span className="sr-only">Actions</span>
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
