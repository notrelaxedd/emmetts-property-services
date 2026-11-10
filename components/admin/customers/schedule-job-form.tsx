"use client"

import * as React from "react"
import { crewForNewJob, scheduleForCustomer } from "@/app/admin/actions/schedule"
import { INTERACTION_CATEGORIES } from "@/components/admin/customers/format"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { PaymentMethod } from "@/lib/db/types"
import type { CrewChoice } from "@/lib/ops/crew-offers"

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "stripe", label: "Card" },
]

const WHY: Record<string, string> = {
  unavailable: "outside their hours",
  time_off: "time off",
  busy: "on another job",
  paused: "paused",
  removed: "removed",
}

/**
 * "Schedule a job" on a customer's page: what, price, how long, the day and who's on it. Skips the quote
 * form and the AI estimate. With a day it's booked on the calendar (only the ticked crew are emailed);
 * leave the day blank and it waits on the schedule's "Needs a day" list.
 */
export function ScheduleJobForm({ today, customer }: { today: string; customer: { id: string; name: string } }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [description, setDescription] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [hours, setHours] = React.useState("1")
  const [method, setMethod] = React.useState<PaymentMethod>("cash")
  const [date, setDate] = React.useState("")
  const [time, setTime] = React.useState("09:00")
  const [crew, setCrew] = React.useState<CrewChoice[] | null>(null)
  const [crewError, setCrewError] = React.useState<string | null>(null)
  const [ticked, setTicked] = React.useState<Set<string>>(new Set())
  const id = (k: string) => `sj-${k}`
  const minutes = Math.round(Number(hours) * 60)

  // Who's free follows the day, time and length.
  React.useEffect(() => {
    if (!date || !time || !(minutes > 0)) {
      setCrew(null)
      setCrewError(null)
      return
    }
    let live = true
    setCrewError(null)
    const t = setTimeout(() => {
      void crewForNewJob(date, time, minutes).then((r) => {
        if (!live) return
        if (r.ok) setCrew(r.crew)
        else setCrewError(r.reason)
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [date, time, minutes])

  const toggle = (crewId: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t)
      if (on) next.add(crewId)
      else next.delete(crewId)
      return next
    })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const crewIds = crew ? Array.from(ticked).filter((c) => crew.some((x) => x.id === c)) : []
    startTransition(async () => {
      const r = await scheduleForCustomer({
        customerId: customer.id,
        description,
        price: Number(price),
        hours: Number(hours),
        paymentMethod: method,
        date,
        time: date ? time : "",
        crewIds: date ? crewIds : [],
      })
      if (r.ok) {
        toast({ title: r.message ?? "Saved", description: `${customer.name}: ${description.trim()}`, variant: "success" })
        setDescription("")
        setPrice("")
        setHours("1")
        setDate("")
        setTicked(new Set())
      } else toast({ title: "Couldn't schedule the job", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={id("what")}>What we&apos;re doing</Label>
          <Input
            id={id("what")}
            list={id("what-list")}
            value={description}
            maxLength={250}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Fall cleanup"
            required
          />
          <datalist id={id("what-list")}>
            {INTERACTION_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("price")}>Price ($)</Label>
          <Input id={id("price")} type="number" inputMode="decimal" min={0} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("hours")}>Hours on site</Label>
          <Input id={id("hours")} type="number" inputMode="decimal" min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={id("date")}>Day</Label>
          <Input id={id("date")} type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("time")}>Start time</Label>
          <Input id={id("time")} type="time" step={900} value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} required={!!date} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("method")}>Pays by</Label>
          <NativeSelect id={id("method")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {date ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-ink">Crew (only the ones you tick are emailed)</legend>
          {crewError ? <p className="text-sm text-destructive">{crewError}</p> : null}
          {!crew && !crewError ? <p className="text-sm text-ink-muted">Checking who&apos;s free…</p> : null}
          {crew && !crew.length ? <p className="text-sm text-ink-muted">No active crew yet.</p> : null}
          {crew?.length ? (
            <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
              {crew.map((c) => {
                const cid = id(`crew-${c.id}`)
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox id={cid} checked={ticked.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
                    <label htmlFor={cid} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className={c.free ? "text-xs text-brand-green-dark" : "text-xs text-ink-muted"}>
                        {c.free ? "free" : WHY[c.why ?? ""] ?? "not free"}
                        {c.hasEmail ? "" : " · no email"}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-xs text-ink-muted">No day yet? Leave it blank and the job waits on the schedule&apos;s &quot;Needs a day&quot; list.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !description.trim() || price === "" || !(Number(hours) > 0)}>
          {pending ? "Scheduling…" : date ? "Schedule & book" : "Save job"}
        </Button>
        {date ? <p className="text-xs text-ink-muted">The customer gets the usual confirmation email if they have one on file.</p> : null}
      </div>
    </form>
  )
}
