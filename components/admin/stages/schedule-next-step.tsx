"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarPlus, CheckCircle2, PhoneCall } from "lucide-react"
import { confirmBooking, markJobDone, moveJob } from "@/app/admin/actions/schedule"
import { fmtMinutes, hhmm } from "@/components/admin/schedule/status"
import type { ScheduleJob } from "@/components/admin/schedule/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { PaymentMethod } from "@/lib/db/types"
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { addDays, localDate, zonedToUtc } from "@/lib/scheduler/time"

const TIMES = Array.from({ length: 26 }, (_, i) => 7 * 60 + i * 30)
type Result = { ok: true; message?: string } | { ok: false; reason: string }

/**
 * The one next step for a job on the front page's Schedule stage, through the same booking actions the
 * schedule board uses: put it on the calendar (`moveJob`), mark it confirmed with how they'll pay after
 * the job (`confirmBooking`), or mark it done (`markJobDone`).
 */
export function ScheduleNextStep({ job, quoteHref }: { job: ScheduleJob; quoteHref: string | null }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState(() => addDays(localDate(new Date()), 1))
  const [start, setStart] = React.useState(9 * 60)
  const [method, setMethod] = React.useState<PaymentMethod>(job.quote?.paymentMethod ?? "check")
  const [hours, setHours] = React.useState(() => String(Math.max(0.25, Math.round((job.estMinutes / 60) * 4) / 4)))
  const ids = { date: `ns-date-${job.id}`, time: `ns-time-${job.id}`, method: `ns-pay-${job.id}`, hours: `ns-hours-${job.id}` }

  const run = (fn: () => Promise<Result>, failTitle: string) =>
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast({ title: r.message ?? "Done", variant: "success", duration: 9000 })
        setOpen(false)
      } else toast({ title: failTitle, description: r.reason, variant: "destructive" })
    })

  if (job.status === "unscheduled") {
    if (!open) {
      return (
        <Button type="button" size="sm" className="h-11 sm:h-9" onClick={() => setOpen(true)}>
          <CalendarPlus aria-hidden="true" /> Put on the calendar
        </Button>
      )
    }
    return (
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
          run(() => moveJob(job.id, zonedToUtc(date, hhmm(start)).toISOString()), "Can't put the job there")
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={ids.date}>Day</Label>
          <Input id={ids.date} type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={ids.time}>Start</Label>
          <NativeSelect id={ids.time} value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {fmtMinutes(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="h-11 sm:h-9">
            {pending ? "Saving…" : "Put it there"}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} className="h-11 sm:h-9" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-ink-muted sm:col-span-3">Every crew member who could work it gets an email asking if they&apos;re free. Then you call the customer.</p>
      </form>
    )
  }

  if (job.status === "proposed" || job.status === "crew_confirmed") {
    // Same default as the job dialog: whoever said yes, up to the crew the estimate asks for.
    const crewIds = job.crew.filter((c) => c.status === "accepted").slice(0, Math.max(1, job.crewSize)).map((c) => c.id)
    if (job.quote?.needsOwner) {
      return (
        <p className="text-xs text-amber-900">
          A line on the quote still needs your price.{" "}
          {quoteHref ? (
            <Link className="underline" href={quoteHref} scroll={false}>
              Open the quote
            </Link>
          ) : null}
        </p>
      )
    }
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => confirmBooking({ jobId: job.id, payment_method: method, crew_ids: crewIds }), "Couldn't book the job")
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={ids.method}>They&apos;ll pay after the job by</Label>
          <NativeSelect id={ids.method} className="h-11 w-44 sm:h-9" value={method} disabled={pending} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending} className="h-11 sm:h-9">
          <PhoneCall aria-hidden="true" /> {pending ? "Booking…" : "Mark confirmed"}
        </Button>
        <span className="w-full text-xs text-ink-muted">
          {crewIds.length ? `${crewIds.length} crew who said yes go.` : "Just you (nobody has said yes yet)."} Pick crew by hand on the full schedule.
        </span>
      </form>
    )
  }

  if (job.status === "booked" || job.status === "in_progress") {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => markJobDone(job.id, Number(hours)), "Couldn't mark it done")
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={ids.hours}>Hours on site</Label>
          <Input id={ids.hours} type="number" min={0.25} max={24} step={0.25} className="h-11 w-24 sm:h-9" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending || !(Number(hours) >= 0.25)} className="h-11 sm:h-9">
          <CheckCircle2 aria-hidden="true" /> {pending ? "Saving…" : "Complete"}
        </Button>
      </form>
    )
  }

  return null
}
