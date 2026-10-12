"use client"

import * as React from "react"
import { cancelJob, setWeatherHold } from "@/app/admin/actions/schedule"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { fmtDuration, fmtMinutes, LOCKED_STATUSES, STATUS_LABEL } from "./status"
import type { ScheduleDay, ScheduleJob } from "./types"

const TIMES = Array.from({ length: 26 }, (_, i) => 7 * 60 + i * 30)

const ASSIGNMENT_LABEL: Record<string, string> = {
  offered: "asked",
  accepted: "accepted",
  swap_offered: "swap offered",
  drop_requested: "wants to drop",
}

export function JobDialog({
  job,
  days,
  open,
  onOpenChange,
  onMove,
}: {
  job: ScheduleJob | null
  days: ScheduleDay[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMove: (date: string, startMin: number) => void
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const [date, setDate] = React.useState("")
  const [start, setStart] = React.useState(9 * 60)

  React.useEffect(() => {
    if (!job) return
    setDate(job.date ?? days[0]?.date ?? "")
    setStart(job.startMin !== null ? Math.min(19 * 60 + 30, Math.max(7 * 60, job.startMin - (job.startMin % 30))) : 9 * 60)
  }, [job, days])

  if (!job) return null
  const locked = LOCKED_STATUSES.includes(job.status)
  const terminal = job.status === "done" || job.status === "cancelled"

  const toggleHold = (hold: boolean) =>
    startTransition(async () => {
      const r = await setWeatherHold(job.id, hold)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't update the hold", description: r.reason, variant: "destructive" })
    })

  const doCancel = () =>
    startTransition(async () => {
      const r = await cancelJob(job.id)
      setConfirmCancel(false)
      if (r.ok) {
        toast({ title: r.message ?? "Job cancelled.", variant: "success" })
        onOpenChange(false)
      } else toast({ title: "Couldn't cancel the job", description: r.reason, variant: "destructive" })
    })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{job.customerName}</DialogTitle>
            <DialogDescription>{job.whenLabel ?? "Not scheduled yet"}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant={job.status === "booked" ? "success" : job.status === "proposed" ? "warning" : "outline"}>
              {STATUS_LABEL[job.status]}
            </Badge>
            {job.weatherHold ? <Badge variant="outline">⛈ Weather hold</Badge> : null}
            <Badge variant={job.paid ? "secondary" : "outline"}>{job.paid ? "Paid" : "Unpaid"}</Badge>
          </div>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">Address</dt>
            <dd className="text-ink">{job.address ?? "—"}</dd>
            <dt className="text-ink-muted">Services</dt>
            <dd className="text-ink">{job.services.join(", ") || "—"}</dd>
            <dt className="text-ink-muted">Length</dt>
            <dd className="text-ink">
              {fmtDuration(job.estMinutes)} · {job.crewSize} crew
            </dd>
            <dt className="text-ink-muted">Crew</dt>
            <dd className="text-ink">
              {job.crew.length
                ? job.crew.map((c) => `${c.name} (${ASSIGNMENT_LABEL[c.status] ?? c.status})`).join(", ")
                : "None assigned yet"}
            </dd>
            {job.scheduleReason ? (
              <>
                <dt className="text-ink-muted">Why this slot</dt>
                <dd className="text-ink">{job.scheduleReason}</dd>
              </>
            ) : null}
          </dl>

          {!locked ? (
            <form
              className="grid gap-2 rounded-md border border-ink/10 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
                onMove(date, start)
                onOpenChange(false)
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="move-date">Move to</Label>
                <Input id="move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="move-time">Start</Label>
                <NativeSelect id="move-time" value={start} onChange={(e) => setStart(Number(e.target.value))}>
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {fmtMinutes(t)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" variant="outline" disabled={pending}>
                Move
              </Button>
              <p className="text-xs text-ink-muted sm:col-span-3">
                Or drag the block on the grid. Crew who already accepted will be asked again.
              </p>
            </form>
          ) : null}

          {!terminal ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 p-3">
              <div>
                <Label htmlFor="weather-hold">Weather hold</Label>
                <p className="text-xs text-ink-muted">Holds the job and asks the scheduler to re-plan it.</p>
              </div>
              <Switch id="weather-hold" checked={job.weatherHold} disabled={pending} onCheckedChange={toggleHold} />
            </div>
          ) : null}

          <DialogFooter>
            {!terminal ? (
              <Button variant="outline" className="text-destructive" disabled={pending} onClick={() => setConfirmCancel(true)}>
                Cancel job
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this job?</DialogTitle>
            <DialogDescription>
              {job.customerName}
              {job.whenLabel ? `, ${job.whenLabel}` : ""}. This can&apos;t be undone. Refund the customer from the quote if they paid.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep job
            </Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={pending} onClick={doCancel}>
              Yes, cancel it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
