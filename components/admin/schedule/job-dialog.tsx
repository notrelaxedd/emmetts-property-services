"use client"

import * as React from "react"
import Link from "next/link"
import { Banknote, Crown, Mail, Pencil, Phone, RotateCcw, Send, UserPlus } from "lucide-react"
import {
  askMoreCrew,
  cancelJob,
  confirmBooking,
  editJobCrew,
  releaseJob,
  remindCrew,
  setOwnersWorking,
  setWeatherHold,
  unplaceJob,
} from "@/app/admin/actions/schedule"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import type { PaymentMethod } from "@/lib/db/types"
import { BASIS_LABEL, hrs, isGoing, usd } from "@/lib/schedule/money"
import { cn } from "@/lib/utils"
import { zonedToUtc } from "@/lib/scheduler/time"
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { CrewPicker } from "./crew-picker"
import { CREW_ANSWER, fmtDuration, fmtMinutes, fmtPhone, hhmm, LOCKED_STATUSES, STATUS_LABEL, telHref } from "./status"
import type { ScheduleDay, ScheduleJob } from "./types"

const TIMES = Array.from({ length: 26 }, (_, i) => 7 * 60 + i * 30)
const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })

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
  const [asking, setAsking] = React.useState(false)
  const [editingCrew, setEditingCrew] = React.useState(false)
  const [date, setDate] = React.useState("")
  const [start, setStart] = React.useState(9 * 60)
  const [method, setMethod] = React.useState<PaymentMethod>("check")
  const [picked, setPicked] = React.useState<string[]>([])
  const [note, setNote] = React.useState("")

  React.useEffect(() => {
    if (!job) return
    setDate(job.date ?? days.find((d) => !d.isToday && d.date > (days[0]?.date ?? ""))?.date ?? days[0]?.date ?? "")
    setStart(job.startMin !== null ? Math.min(19 * 60 + 30, Math.max(7 * 60, job.startMin - (job.startMin % 30))) : 9 * 60)
    setMethod(job.quote?.paymentMethod ?? "check")
    // Default crew: whoever said yes, up to the crew the estimate asks for.
    setPicked(job.crew.filter((c) => c.status === "accepted").slice(0, Math.max(1, job.crewSize)).map((c) => c.id))
    setNote("")
    setConfirmCancel(false)
  }, [job, days])

  if (!job) return null
  const locked = LOCKED_STATUSES.includes(job.status)
  const terminal = job.status === "done" || job.status === "cancelled"
  const onCalendar = job.status === "proposed" || job.status === "crew_confirmed"
  const crewEditable = job.status === "booked" || job.status === "in_progress"
  const onJob = job.crew.filter((c) => c.status === "accepted" || c.status === "drop_requested" || c.status === "swap_offered").map((c) => c.id)
  const awaitingCall = onCalendar
  const unpaid = !!job.quote && !job.quote.paidAt
  const ids = { method: `pay-${job.id}`, note: `note-${job.id}`, date: `move-date-${job.id}`, time: `move-time-${job.id}` }

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; reason: string }>, failTitle: string, close = false) =>
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast({ title: r.message ?? "Done", variant: "success", duration: 9000 })
        if (close) onOpenChange(false)
      } else toast({ title: failTitle, description: r.reason, variant: "destructive" })
    })

  const togglePick = (id: string, on: boolean) => setPicked((p) => (on ? Array.from(new Set([...p, id])) : p.filter((x) => x !== id)))
  const pickable = job.crew.filter((c) => c.status === "offered" || c.status === "accepted")
  const cant = job.crew.filter((c) => c.status === "declined")
  const confirmBlocker = job.quote?.needsOwner ? "A line on the quote still needs your price." : null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto p-4 sm:max-w-lg sm:p-5">
          <SheetHeader className="pr-14 text-left">
            <SheetTitle className="text-xl font-bold text-ink">{job.customerName}</SheetTitle>
            <SheetDescription>
              {job.whenLabel ?? "Not on the calendar yet"} · {hrs(job.hours)}
              {job.address ? ` · ${job.address}` : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant={job.status === "booked" ? "success" : onCalendar ? "warning" : "outline"}>{STATUS_LABEL[job.status]}</Badge>
            {job.weatherHold ? <Badge variant="outline">⛈ Weather hold</Badge> : null}
            {job.ownerHold ? <Badge variant="outline">Held</Badge> : null}
            {job.quote ? (
              <Badge variant={job.quote.paidAt ? "secondary" : "outline"}>
                {job.quote.paidAt
                  ? `Paid ${dateFmt.format(new Date(job.quote.paidAt))}`
                  : job.quote.paymentMethod
                    ? `Pays by ${PAYMENT_METHOD_LABEL[job.quote.paymentMethod].toLowerCase()} after the job`
                    : "Payment after the job"}
              </Badge>
            ) : null}
          </div>

          <MoneyBlock job={job} />

          {!terminal || job.status === "done" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 p-3">
              <div>
                <Label htmlFor={`owners-${job.id}`} className="flex items-center gap-1.5">
                  <Crown className="size-4" aria-hidden="true" /> Owners doing this job
                </Label>
                <p className="text-xs text-ink-muted">You and Emmett do the work: no crew pay comes out, it&apos;s all take-home.</p>
              </div>
              <Switch
                id={`owners-${job.id}`}
                checked={job.ownersWorking}
                disabled={pending}
                onCheckedChange={(on) => run(() => setOwnersWorking(job.id, on), "Couldn't update the job")}
              />
            </div>
          ) : null}

          {/* Who to call */}
          <div className="grid gap-2 rounded-md border border-ink/10 bg-paper p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">
                {awaitingCall ? "Call to confirm the quote and the day" : "Customer"}
              </p>
              <p className="text-ink-muted">
                {job.phone ? fmtPhone(job.phone) : "No phone number on file"}
                {job.email ? ` · ${job.email}` : ""}
              </p>
              {awaitingCall ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Tell them the price{job.quote ? ` (${money(job.quote.priceTotal)})` : ""}, the day, and that you collect cash, check or card once the job is done.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {job.phone ? (
                <Button asChild size="sm" variant={awaitingCall ? "default" : "outline"}>
                  <a href={telHref(job.phone)}>
                    <Phone aria-hidden="true" /> Call
                  </a>
                </Button>
              ) : null}
              {job.email ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${job.email}`}>
                    <Mail aria-hidden="true" /> Email
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">Address</dt>
            <dd className="text-ink">{job.address ?? "—"}</dd>
            <dt className="text-ink-muted">Services</dt>
            <dd className="text-ink">{job.services.join(", ") || "—"}</dd>
            <dt className="text-ink-muted">Estimate</dt>
            <dd className="text-ink">
              {fmtDuration(job.estMinutes)} · {job.crewSize} crew
              {job.quote ? (
                <>
                  {" · "}
                  <Link className="underline" href={`/admin/quotes/${job.quote.id}`}>
                    {money(job.quote.priceTotal)} quote
                  </Link>
                </>
              ) : null}
            </dd>
            {job.scheduleReason ? (
              <>
                <dt className="text-ink-muted">Note</dt>
                <dd className="text-ink">{job.scheduleReason}</dd>
              </>
            ) : null}
          </dl>

          {/* Crew answers */}
          {job.status !== "unscheduled" && job.status !== "cancelled" && job.status !== "done" ? (
            <div className="space-y-2 rounded-md border border-ink/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{crewEditable ? "Crew on the job" : "Who's free"}</p>
                {crewEditable ? (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => setEditingCrew(true)}>
                    <Pencil aria-hidden="true" /> Edit crew
                  </Button>
                ) : null}
                {onCalendar ? (
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => setAsking(true)}>
                      <UserPlus aria-hidden="true" /> Ask crew
                    </Button>
                    {job.crew.length ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => run(() => remindCrew(job.id), "Couldn't email the crew")}>
                        <Send aria-hidden="true" /> Ask again
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {job.crew.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  {crewEditable
                    ? "Just you on this one. Use Edit crew to put people on it."
                    : "Nobody was asked about this job. Use Ask crew to pick people, or book it with just you."}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {[...pickable, ...cant].map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      {onCalendar && c.status !== "declined" ? (
                        <Checkbox id={`crew-${job.id}-${c.id}`} checked={picked.includes(c.id)} onCheckedChange={(v) => togglePick(c.id, v === true)} disabled={pending} />
                      ) : (
                        <span className="inline-block size-5" aria-hidden="true" />
                      )}
                      <label htmlFor={`crew-${job.id}-${c.id}`} className="flex-1 text-ink">
                        {c.name}
                      </label>
                      <Badge variant={CREW_ANSWER[c.status].variant}>{crewEditable && c.status === "accepted" ? "On it" : CREW_ANSWER[c.status].label}</Badge>
                      {!c.notified && c.status === "offered" ? <span className="text-xs text-ink-muted">no email</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {onCalendar ? (
                <p className="text-xs text-ink-muted">
                  Tick who goes. {job.crewSize > 1 ? `The estimate assumes ${job.crewSize}.` : ""} Leave everyone unticked if it&apos;s just you.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Confirm with the customer */}
          {onCalendar ? (
            <form
              className="space-y-3 rounded-md border-2 border-brand-green-dark/60 bg-brand-green/10 p-3"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => confirmBooking({ jobId: job.id, payment_method: method, crew_ids: picked, note: note.trim() || undefined }), "Couldn't book the job", true)
              }}
            >
              <p className="text-sm font-semibold text-ink">Customer said yes?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.method}>They&apos;ll pay by</Label>
                  <NativeSelect id={ids.method} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={pending}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.note}>Note (optional)</Label>
                  <Input id={ids.note} value={note} maxLength={500} placeholder="Gate code 1234, dog in yard…" onChange={(e) => setNote(e.target.value)} disabled={pending} />
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                Collected after the job: cash or check in person (record it on the quote), or a card link emailed from the quote page.
                {job.email ? " The customer gets a confirmation email." : " No email on file, so no confirmation email goes out."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={pending || !!confirmBlocker}>
                  <Banknote aria-hidden="true" /> {pending ? "Booking…" : `Book it: ${picked.length ? `${picked.length} crew` : "just me"}, pays by ${PAYMENT_METHOD_LABEL[method].split(" ")[0].toLowerCase()}`}
                </Button>
                {confirmBlocker ? (
                  <span className="text-xs text-amber-900">
                    {confirmBlocker}{" "}
                    {job.quote ? (
                      <Link className="underline" href={`/admin/quotes/${job.quote.id}`}>
                        Open the quote
                      </Link>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </form>
          ) : null}

          {job.status === "done" && unpaid && job.quote ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-amber-400 bg-amber-100 p-3 text-sm text-amber-950">
              <p>
                <span className="font-semibold">Collect {money(job.quote.priceTotal)}</span>
                {job.quote.paymentMethod ? ` by ${PAYMENT_METHOD_LABEL[job.quote.paymentMethod].toLowerCase()}` : ""}.
              </p>
              <Button asChild size="sm">
                <Link href={`/admin/quotes/${job.quote.id}`}>Record payment</Link>
              </Button>
            </div>
          ) : null}

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
                <Label htmlFor={ids.date}>{job.status === "unscheduled" ? "Put it on" : "Move to"}</Label>
                <Input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.time}>Start</Label>
                <NativeSelect id={ids.time} value={start} onChange={(e) => setStart(Number(e.target.value))}>
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {fmtMinutes(t)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" variant="outline" disabled={pending}>
                {job.status === "unscheduled" ? "Put on calendar" : "Move"}
              </Button>
              <p className="text-xs text-ink-muted sm:col-span-3">
                {job.status === "unscheduled"
                  ? "Or drag it from the rail onto the grid. Every crew member who could work the slot gets an email asking if they're free."
                  : job.status === "booked"
                    ? "Or drag the block on the grid. Moving a confirmed job means calling the customer again: it goes back to “call to confirm”."
                    : "Or drag the block on the grid. The crew are asked again for the new time."}
              </p>
            </form>
          ) : null}

          {job.ownerHold && job.status === "unscheduled" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 p-3">
              <div>
                <p className="text-sm font-medium text-ink">Held by you</p>
                <p className="text-xs text-ink-muted">The scheduler won&apos;t suggest a slot for it until you release it. Dragging it onto the calendar works any time.</p>
              </div>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => releaseJob(job.id), "Couldn't release the job")}>
                Release
              </Button>
            </div>
          ) : null}

          {!terminal && job.status !== "unscheduled" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 p-3">
              <div>
                <Label htmlFor={`weather-hold-${job.id}`}>Weather hold</Label>
                <p className="text-xs text-ink-muted">Takes the job off its day and back to the rail for a new one.</p>
              </div>
              <Switch
                id={`weather-hold-${job.id}`}
                checked={job.weatherHold}
                disabled={pending}
                onCheckedChange={(hold) => run(() => setWeatherHold(job.id, hold), "Couldn't update the hold")}
              />
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-ink/10 pt-3">
            <div className="flex flex-wrap gap-2">
              {!terminal ? (
                <Button variant="outline" className="text-destructive" disabled={pending} onClick={() => setConfirmCancel(true)}>
                  Cancel job
                </Button>
              ) : null}
              {job.status !== "unscheduled" && !locked ? (
                <Button variant="outline" disabled={pending} onClick={() => run(() => unplaceJob(job.id), "Couldn't take it off the calendar", true)}>
                  <RotateCcw aria-hidden="true" /> Back to the rail
                </Button>
              ) : null}
            </div>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this job?</DialogTitle>
            <DialogDescription>
              {job.customerName}
              {job.whenLabel ? `, ${job.whenLabel}` : ""}. This can&apos;t be undone.{" "}
              {job.quote?.paidAt ? "The quote is paid: refund it from the quote page if you need to." : "The quote is marked declined."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep job
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={() => {
                setConfirmCancel(false)
                run(() => cancelJob(job.id), "Couldn't cancel the job", true)
              }}
            >
              Yes, cancel it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {(
        <CrewPicker
          open={asking}
          jobId={job.id}
          startISO={job.date !== null && job.startMin !== null ? zonedToUtc(job.date, hhmm(job.startMin)).toISOString() : null}
          minutes={Math.max(30, (job.endMin ?? 0) - (job.startMin ?? 0) || job.estMinutes)}
          title={`Ask crew about ${job.customerName}`}
          description="Tick who to ask."
          emailHint="Sends the “are you free?” email. Off: they only see the offer in the crew app."
          confirmLabel="Ask"
          allowNone={false}
          onCancel={() => setAsking(false)}
          onConfirm={(ids, notify) => {
            setAsking(false)
            run(() => askMoreCrew(job.id, ids, notify), "Couldn't ask the crew")
          }}
        />
      )}
      {crewEditable ? (
        <CrewPicker
          open={editingCrew}
          jobId={job.id}
          startISO={job.date !== null && job.startMin !== null ? zonedToUtc(job.date, hhmm(job.startMin)).toISOString() : null}
          minutes={Math.max(30, (job.endMin ?? 0) - (job.startMin ?? 0) || job.estMinutes)}
          title={`Crew for ${job.customerName}`}
          description="Tick everyone who's going. Untick someone to take them off. Leave everyone unticked if it's just you."
          emailHint="Emails only the people you add or take off. Off: no emails, it just updates the crew app."
          confirmLabel="Save crew"
          initialTicked={onJob}
          onCancel={() => setEditingCrew(false)}
          onConfirm={(ids, notify) => {
            setEditingCrew(false)
            run(() => editJobCrew(job.id, ids, notify), "Couldn't change the crew")
          }}
        />
      ) : null}
    </>
  )
}

/** Where the money goes on this job: price, crew pay (per person), card fee if they pay by card, take-home. */
function MoneyBlock({ job }: { job: ScheduleJob }) {
  const m = job.money
  const going = job.crew.filter((c) => isGoing(c.status))
  const perPerson = m.basis === "crew" && !job.ownersWorking
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-3">
      <dl className={cn("grid gap-2 text-center", ["grid-cols-3", "grid-cols-4", "grid-cols-5"][(m.fee > 0 ? 1 : 0) + (m.costs > 0 ? 1 : 0)])}>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Price</dt>
          <dd className="text-lg font-bold tabular-nums text-ink">{usd(m.price)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Crew pay</dt>
          <dd className="text-lg font-bold tabular-nums text-ink">{usd(m.labor)}</dd>
        </div>
        {m.costs > 0 ? (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costs</dt>
            <dd className="text-lg font-bold tabular-nums text-ink">{usd(m.costs)}</dd>
          </div>
        ) : null}
        {m.fee > 0 ? (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Card fee</dt>
            <dd className="text-lg font-bold tabular-nums text-ink">{usd(m.fee)}</dd>
          </div>
        ) : null}
        <div className="rounded-md bg-brand-green/15">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Take-home</dt>
          <dd className={cn("text-lg font-bold tabular-nums", m.profit < 0 ? "text-destructive" : "text-brand-green-dark")}>{usd(m.profit)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-ink-muted">
        Crew pay: {BASIS_LABEL[m.basis]}
        {m.basis === "estimate" ? ` (${job.crewSize} crew × ${hrs(job.hours)})` : ""}.
        {job.hours > 0 && m.price > 0 ? ` ${usd(Math.round(m.profit / job.hours))}/h take-home.` : ""}
      </p>
      {perPerson && going.length ? (
        <ul className="mt-1 space-y-0.5 text-xs text-ink">
          {going.map((c) => (
            <li key={c.id} className="flex justify-between tabular-nums">
              <span>
                {c.name} · {usd(c.rate)}/h × {hrs(job.hours)}
              </span>
              <span>{usd(c.rate * job.hours)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
