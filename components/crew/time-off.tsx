"use client"

import { CalendarOff, CalendarPlus, Loader2, Send, Trash2 } from "lucide-react"
import * as React from "react"
import { cancelTimeOff, requestTimeOff } from "@/app/crew/actions/time-off"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { CrewException, ExceptionKind, ExceptionStatus } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { clockLabel, dateLabel } from "./format"
import { useCrewAction } from "./use-crew-action"

const STATUS: Record<ExceptionStatus, { label: string; variant: "warning" | "success" | "destructive" }> = {
  pending: { label: "Waiting for OK", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
}

const field = "h-11 text-base"

export function TimeOffForm({ today }: { today: string }) {
  const { run, pending } = useCrewAction()
  const [kind, setKind] = React.useState<ExceptionKind>("off")
  const [from, setFrom] = React.useState(today)
  const [to, setTo] = React.useState(today)
  const [partial, setPartial] = React.useState(false)
  const [start, setStart] = React.useState("08:00")
  const [end, setEnd] = React.useState("12:00")
  const [note, setNote] = React.useState("")

  const error =
    !from || !to
      ? "Pick the dates."
      : to < from
        ? "The end date is before the start date."
        : from < today
          ? "Pick today or a later date."
          : partial && (!start || !end || start >= end)
            ? "The end time must be after the start time."
            : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (error) return
    const ok = await run("request", () =>
      requestTimeOff({
        kind,
        date_from: from,
        date_to: to,
        start_time: partial ? start : null,
        end_time: partial ? end : null,
        note: note.trim() || null,
      }),
    )
    if (ok) {
      setPartial(false)
      setNote("")
      setFrom(today)
      setTo(today)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New request</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <fieldset>
            <legend className="sr-only">Kind</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {(
                [
                  { value: "off", label: "Time off", icon: CalendarOff },
                  { value: "extra", label: "Extra availability", icon: CalendarPlus },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className={cn(
                    "flex min-h-12 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
                    kind === value ? "border-ink bg-ink text-white" : "border-input bg-white text-ink hover:bg-ink/[0.04]",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to-from">From</Label>
              <Input
                id="to-from"
                type="date"
                className={field}
                min={today}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  if (to < e.target.value) setTo(e.target.value)
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to-to">To</Label>
              <Input
                id="to-to"
                type="date"
                className={field}
                min={from || today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </div>
          </div>

          <label htmlFor="to-partial" className="flex min-h-11 cursor-pointer items-center gap-3">
            <Checkbox id="to-partial" checked={partial} onCheckedChange={(v) => setPartial(v === true)} className="size-6" />
            <span className="text-sm font-medium text-ink">Only part of the day</span>
          </label>

          {partial ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to-start">Start</Label>
                <Input id="to-start" type="time" step={900} className={field} value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to-end">End</Label>
                <Input id="to-end" type="time" step={900} className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to-note">
              Note <span className="font-normal text-ink-muted">(optional)</span>
            </Label>
            <Textarea
              id="to-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder={kind === "off" ? "e.g. Dentist appointment" : "e.g. Free all day if you need me"}
              className="text-base"
            />
          </div>

          {error && from && to ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="h-12 text-base" disabled={pending || !!error}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {kind === "off" ? "Request time off" : "Add extra availability"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function TimeOffList({ items, today }: { items: CrewException[]; today: string }) {
  const { run, pending, busyKey } = useCrewAction()
  const [confirm, setConfirm] = React.useState<CrewException | null>(null)

  if (items.length === 0) {
    return <EmptyState icon={CalendarOff} title="No requests yet" description="Your time off and extra days will show up here." />
  }

  const upcoming = items.filter((e) => e.date_to >= today).sort((a, b) => a.date_from.localeCompare(b.date_from))
  const past = items.filter((e) => e.date_to < today)

  const row = (e: CrewException) => {
    const status = STATUS[e.status]
    const dates = e.date_from === e.date_to ? dateLabel(e.date_from) : `${dateLabel(e.date_from)} – ${dateLabel(e.date_to)}`
    const times = e.start_time && e.end_time ? `${clockLabel(e.start_time)}–${clockLabel(e.end_time)}` : "All day"
    const cancellable = e.date_to >= today && (e.status === "pending" || e.status === "approved")
    return (
      <li key={e.id}>
        <Card>
          <CardContent className="flex items-start gap-3 pt-4">
            <span
              className={cn(
                "mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full",
                e.kind === "off" ? "bg-ink/[0.06] text-ink" : "bg-brand-green/25 text-brand-green-dark",
              )}
            >
              {e.kind === "off" ? <CalendarOff className="size-5" aria-hidden="true" /> : <CalendarPlus className="size-5" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{e.kind === "off" ? "Time off" : "Extra availability"}</p>
              <p className="text-sm text-ink">{dates}</p>
              <p className="text-sm text-ink-muted">{times}</p>
              {e.note ? <p className="mt-1 text-sm text-ink-muted">“{e.note}”</p> : null}
              <Badge variant={status.variant} className="mt-2">
                {status.label}
              </Badge>
            </div>
            {cancellable ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirm(e)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-ink/[0.06] hover:text-destructive disabled:opacity-50"
              >
                {busyKey === e.id ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-5" aria-hidden="true" />}
                <span className="sr-only">Cancel request for {dates}</span>
              </button>
            ) : null}
          </CardContent>
        </Card>
      </li>
    )
  }

  return (
    <>
      {upcoming.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="to-upcoming">
          <h2 id="to-upcoming" className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Upcoming
          </h2>
          <ul className="flex flex-col gap-3">{upcoming.map(row)}</ul>
        </section>
      ) : null}
      {past.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="to-past">
          <h2 id="to-past" className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Past
          </h2>
          <ul className="flex flex-col gap-3 opacity-80">{past.map(row)}</ul>
        </section>
      ) : null}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this request?</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "extra"
                ? "You'll no longer be available on those extra days."
                : "You'll be back to your normal weekly hours for those days."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-12">
                Keep it
              </Button>
            </DialogClose>
            <Button
              type="button"
              className="h-12"
              disabled={pending}
              onClick={async () => {
                if (!confirm) return
                const id = confirm.id
                if (await run(id, () => cancelTimeOff(id))) setConfirm(null)
              }}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Cancel request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
