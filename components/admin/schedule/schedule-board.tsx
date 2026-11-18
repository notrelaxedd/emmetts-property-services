"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Crown, GripVertical, Phone, Play, Users } from "lucide-react"
import { moveJob, releaseJob, runScheduler } from "@/app/admin/actions/schedule"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { hrs, totals, usd, type DayTotals } from "@/lib/schedule/money"
import { zonedToUtc } from "@/lib/scheduler/time"
import { cn } from "@/lib/utils"
import { CrewPicker } from "./crew-picker"
import { IncomingList } from "./incoming-list"
import { JobDialog } from "./job-dialog"
import { fmtMinutes, hhmm, HATCH_STYLE, LOCKED_STATUSES, STATUS_LABEL } from "./status"
import type { Incoming, ScheduleDay, ScheduleJob } from "./types"

/** Start times offered when you drop a job on a day: 6am–8pm every 15 minutes. */
const TIME_OPTIONS = Array.from({ length: (20 - 6) * 4 + 1 }, (_, i) => 6 * 60 + i * 15).map((m) => ({ value: m, label: fmtMinutes(m) }))
const DEFAULT_START = 9 * 60

const up15 = (m: number) => Math.ceil(m / 15) * 15
const down15 = (m: number) => Math.floor(m / 15) * 15
const clampStart = (m: number) => Math.min(20 * 60, Math.max(6 * 60, m))

/** Time range without the repeated am/pm: "9–11:30am", "11:30am–1pm". */
function timeRange(start: number, end: number): string {
  const a = fmtMinutes(start)
  const b = fmtMinutes(end)
  const sameHalf = (start < 720) === (end < 720)
  return `${sameHalf ? a.replace(/am|pm/, "") : a}–${b}`
}

/** One status, one look: a coloured edge, a tint, and a short word. */
const LOOK: Record<ScheduleJob["status"], { edge: string; bg: string; pill: string; word: string }> = {
  unscheduled: { edge: "border-l-ink/30", bg: "bg-white", pill: "bg-gray-light text-ink", word: "Needs a day" },
  proposed: { edge: "border-l-amber-500", bg: "bg-amber-50", pill: "bg-amber-200 text-amber-950", word: "Call" },
  crew_confirmed: { edge: "border-l-amber-500", bg: "bg-amber-50", pill: "bg-amber-200 text-amber-950", word: "Call" },
  booked: { edge: "border-l-brand-green-dark", bg: "bg-white", pill: "bg-brand-green/30 text-ink", word: "Booked" },
  in_progress: { edge: "border-l-blue-600", bg: "bg-blue-50", pill: "bg-blue-600 text-white", word: "Live" },
  done: { edge: "border-l-gray-mid", bg: "bg-paper", pill: "bg-gray-light text-ink-muted", word: "Done" },
  cancelled: { edge: "border-l-gray-mid", bg: "bg-paper opacity-60", pill: "bg-gray-light text-ink-muted", word: "Cancelled" },
}

const LEGEND: { word: string; edge: string }[] = [
  { word: "Call to confirm", edge: "border-l-amber-500 bg-amber-50" },
  { word: "Booked", edge: "border-l-brand-green-dark bg-white" },
  { word: "In progress", edge: "border-l-blue-600 bg-blue-50" },
  { word: "Done", edge: "border-l-gray-mid bg-paper" },
]

/** Who's on a job, in words: "Emma, Michael", "Owners", "1/2 said yes", "Nobody asked". */
function crewLine(job: ScheduleJob): { text: string; warn: boolean } {
  const going = job.crew.filter((c) => c.status === "accepted" || c.status === "drop_requested")
  const names = going.map((c) => c.name.split(" ")[0])
  if (job.ownersWorking) return { text: names.length ? `Owners + ${names.join(", ")}` : "Owners", warn: false }
  const booked = job.status === "booked" || job.status === "in_progress" || job.status === "done"
  if (booked) return { text: names.length ? names.join(", ") : "Just you", warn: false }
  const asked = job.crew.filter((c) => c.status === "offered" || c.status === "accepted")
  if (!asked.length) return { text: "Nobody asked yet", warn: job.status !== "unscheduled" }
  const short = going.length < job.crewSize
  return { text: `${names.length ? `${names.join(", ")} · ` : ""}${going.length}/${Math.max(job.crewSize, asked.length)} said yes`, warn: short }
}

type Placement = { date: string; startMin: number; endMin: number }

export function ScheduleBoard({
  days,
  jobs,
  unscheduled,
  extra = [],
  focusJobId = null,
  incoming = { estimating: [], needsPrice: [] },
}: {
  days: ScheduleDay[]
  jobs: ScheduleJob[]
  unscheduled: ScheduleJob[]
  /** A job linked from elsewhere that is in neither list (another week); only for the panel. */
  extra?: ScheduleJob[]
  focusJobId?: string | null
  /** Requests still being estimated / waiting on your price, shown above the draggable jobs. */
  incoming?: Incoming
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [selectedId, setSelectedId] = React.useState<string | null>(focusJobId)
  const [moved, setMoved] = React.useState<Record<string, Placement>>({})
  const [hover, setHover] = React.useState<{ date: string; index: number } | null>(null)
  const dragId = React.useRef<string | null>(null)
  // A drop opens "what time, and who should we ask?"; the job moves once you confirm.
  const [drop, setDrop] = React.useState<{ job: ScheduleJob; date: string; startMin: number } | null>(null)

  const allJobs = React.useMemo(() => [...jobs, ...unscheduled, ...extra], [jobs, unscheduled, extra])
  const selected = allJobs.find((j) => j.id === selectedId) ?? null
  const durationOf = (job: ScheduleJob) => (job.endMin ?? 0) - (job.startMin ?? 0) || Math.max(30, job.estMinutes) || 60

  /** Where each job sits right now (optimistic moves included). */
  const placeOf = React.useCallback(
    (j: ScheduleJob): Placement | null => {
      const m = moved[j.id]
      if (m) return m
      return j.date && j.startMin !== null && j.endMin !== null ? { date: j.date, startMin: j.startMin, endMin: j.endMin } : null
    },
    [moved],
  )

  const byDay = React.useMemo(() => {
    const map = new Map<string, { job: ScheduleJob; at: Placement }[]>(days.map((d) => [d.date, []]))
    for (const job of [...jobs, ...unscheduled]) {
      const at = placeOf(job)
      if (at) map.get(at.date)?.push({ job, at })
    }
    Array.from(map.values()).forEach((list) => list.sort((a, b) => a.at.startMin - b.at.startMin || a.at.endMin - b.at.endMin))
    return map
  }, [days, jobs, unscheduled, placeOf])

  const dayTotals = React.useMemo(() => {
    const out = new Map<string, DayTotals>()
    byDay.forEach((list, date) => out.set(date, totals(list.map((x) => x.job))))
    return out
  }, [byDay])
  const week = React.useMemo(() => totals(Array.from(byDay.values()).flatMap((list) => list.map((x) => x.job))), [byDay])
  const weekFees = React.useMemo(
    () => Array.from(byDay.values()).flatMap((l) => l).reduce((s, x) => (x.job.status === "cancelled" ? s : s + x.job.money.fee), 0),
    [byDay],
  )
  const calls = jobs.filter((j) => (j.status === "proposed" || j.status === "crew_confirmed") && !moved[j.id])
  const toCollect = jobs.filter((j) => j.status === "done" && j.quote && !j.quote.paidAt)
  const railShown = unscheduled.filter((j) => !moved[j.id])

  const move = (job: ScheduleJob, date: string, startMin: number, crewIds: string[], notify: boolean) => {
    if (job.date === date && job.startMin === startMin) return
    const duration = durationOf(job)
    setMoved((m) => ({ ...m, [job.id]: { date, startMin, endMin: startMin + duration } }))
    startTransition(async () => {
      const res = await moveJob(job.id, zonedToUtc(date, hhmm(startMin)).toISOString(), crewIds, notify)
      setMoved((m) => {
        const next = { ...m }
        delete next[job.id]
        return next
      })
      if (res.ok) toast({ title: job.date ? "Job moved" : "On the calendar", description: res.message, variant: "success", duration: 9000 })
      else toast({ title: "Can't put the job there", description: res.reason, variant: "destructive" })
    })
  }

  /** Dropped at position `index` in a day's list: start right after the job above it. */
  const startFor = (date: string, index: number, job: ScheduleJob): number => {
    const list = (byDay.get(date) ?? []).filter((x) => x.job.id !== job.id && x.job.status !== "cancelled")
    const before = list[index - 1]
    const after = list[index]
    if (before) return clampStart(up15(before.at.endMin))
    if (after) return clampStart(down15(after.at.startMin - durationOf(job)))
    return DEFAULT_START
  }

  const release = (job: ScheduleJob) =>
    startTransition(async () => {
      const r = await releaseJob(job.id)
      toast(r.ok ? { title: r.message ?? "Released", variant: "success" } : { title: "Couldn't release the job", description: r.reason, variant: "destructive" })
    })

  const dragStart = (e: React.DragEvent, job: ScheduleJob) => {
    dragId.current = job.id
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", job.id)
  }
  const dragEnd = () => {
    dragId.current = null
    setHover(null)
  }

  // Busy days get the room; empty days shrink to a narrow drop target.
  const anyJobs = days.some((d) => (byDay.get(d.date)?.length ?? 0) > 0)
  const columns = days.map((d) => (!anyJobs || (byDay.get(d.date)?.length ?? 0) > 0 || d.isToday ? "minmax(0,1fr)" : "minmax(5.5rem,0.45fr)")).join(" ")

  return (
    <div className="space-y-3">
      <CrewPicker
        open={!!drop}
        jobId={drop?.job.id ?? null}
        startISO={drop ? zonedToUtc(drop.date, hhmm(drop.startMin)).toISOString() : null}
        minutes={drop ? durationOf(drop.job) : 60}
        title={drop ? `${drop.job.customerName}: ${drop.job.date ? "move" : "put on the calendar"}` : ""}
        description={drop ? `${days.find((d) => d.date === drop.date)?.weekday ?? ""} ${days.find((d) => d.date === drop.date)?.label ?? drop.date} · ${hrs(drop.job.hours)} job. Tick who to ask, or nobody if it's the owners.` : ""}
        emailHint="Sends the “are you free?” email. Off: they only see the offer in the crew app."
        confirmLabel={drop?.job.date ? "Move" : "Put on calendar"}
        time={drop ? { value: drop.startMin, label: "Start time", options: TIME_OPTIONS, onChange: (m) => setDrop((d) => (d ? { ...d, startMin: m } : d)) } : undefined}
        onCancel={() => setDrop(null)}
        onConfirm={(crewIds, notify) => {
          if (drop) move(drop.job, drop.date, drop.startMin, crewIds, notify)
          setDrop(null)
        }}
      />

      <WeekStrip week={week} fees={weekFees} calls={calls.length} toCollect={toCollect} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
        {LEGEND.map((l) => (
          <span key={l.word} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-4 rounded-sm border border-ink/10 border-l-4", l.edge)} />
            {l.word}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm border border-ink/20" style={HATCH_STYLE} />
          Weather hold
        </span>
        <span>* crew pay is an estimate until the crew is booked</span>
        <span className="hidden lg:inline">· Drag a job onto a day; drop it between jobs to start right after the one above.</span>
        {pending ? <span className="font-semibold text-ink">Saving…</span> : null}
      </div>

      {/* Needs a day: priced jobs to drag down onto the week, plus requests still being priced. */}
      <section className="space-y-2 rounded-lg border border-ink/10 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-bold text-ink">Needs a day{railShown.length ? ` (${railShown.length})` : ""}</span>
            <span className="text-ink-muted"> · drag onto a day, pick the time and crew, then call the customer.</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await runScheduler()
                toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: "Couldn't start the scheduler", description: r.reason, variant: "destructive" })
              })
            }
          >
            <Play /> Suggest slots for everything
          </Button>
        </div>
        <IncomingList incoming={incoming} />
        {railShown.length ? (
          <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {railShown.map((j) => (
              <div key={j.id} className="space-y-1">
                <JobCard job={j} at={null} disabled={pending} onOpen={() => setSelectedId(j.id)} onDragStart={(e) => dragStart(e, j)} onDragEnd={dragEnd} rail />
                {j.quote?.needsOwner ? (
                  <Button asChild variant="ghost" size="sm" className="h-7 w-full text-xs">
                    <Link href={`/admin/quotes/${j.quote.id}`}>Set the rest of the price</Link>
                  </Button>
                ) : null}
                {j.ownerHold ? (
                  <Button variant="ghost" size="sm" className="h-7 w-full text-xs" disabled={pending} onClick={() => release(j)}>
                    Let the scheduler suggest a slot
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Nothing waiting for a day.</p>
        )}
      </section>

      {/* The week: one column per day, jobs stacked in time order. No hour grid, so no empty space. */}
      <div className="flex min-w-0 flex-col gap-2 lg:grid lg:items-start" style={{ gridTemplateColumns: columns }}>
        {days.map((d) => {
          const list = byDay.get(d.date) ?? []
          const t = dayTotals.get(d.date)
          const shrunk = anyJobs && !list.length && !d.isToday
          const hoverIndex = hover?.date === d.date ? hover.index : null
          return (
            <section
              key={d.date}
              aria-label={`${d.weekday} ${d.label}`}
              className={cn(
                "min-w-0 rounded-lg border bg-white shadow-sm",
                d.isToday ? "border-brand-green-dark ring-1 ring-brand-green-dark" : "border-ink/10",
                hoverIndex !== null && "ring-2 ring-ink/40",
              )}
              onDragOver={(e) => {
                if (!dragId.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                // Insertion point from the cards' midpoints.
                const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"))
                let index = cards.length
                for (let i = 0; i < cards.length; i++) {
                  const r = cards[i].getBoundingClientRect()
                  if (e.clientY < r.top + r.height / 2) {
                    index = i
                    break
                  }
                }
                if (hover?.date !== d.date || hover.index !== index) setHover({ date: d.date, index })
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const job = allJobs.find((j) => j.id === dragId.current)
                const index = hover?.date === d.date ? hover.index : list.length
                dragEnd()
                if (!job || LOCKED_STATUSES.includes(job.status)) return
                // The job's own card doesn't count when working out "right after the one above".
                const own = list.findIndex((x) => x.job.id === job.id)
                const at = own !== -1 && own < index ? index - 1 : index
                setDrop({ job, date: d.date, startMin: startFor(d.date, at, job) })
              }}
            >
              <DayHeader day={d} totals={t} shrunk={shrunk} />
              <div className={cn("space-y-1.5 p-1.5", !list.length && "min-h-6 py-1")}>
                {list.map(({ job, at }, i) => (
                  <React.Fragment key={job.id}>
                    {hoverIndex === i ? <DropLine /> : null}
                    <JobCard
                      job={job}
                      at={at}
                      faded={!!moved[job.id]}
                      disabled={pending}
                      onOpen={() => setSelectedId(job.id)}
                      onDragStart={(e) => dragStart(e, job)}
                      onDragEnd={dragEnd}
                    />
                  </React.Fragment>
                ))}
                {hoverIndex !== null && hoverIndex >= list.length ? <DropLine /> : null}
                {!list.length && hoverIndex === null ? (
                  <p className="px-1 text-center text-[11px] leading-4 text-ink-muted/70">Open</p>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>


      <JobDialog
        job={selected}
        days={days}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onMove={(date, startMin) => selected && setDrop({ job: selected, date, startMin })}
      />
    </div>
  )
}

function DropLine() {
  return <div aria-hidden="true" className="h-1 rounded-full bg-ink" />
}

/** The week in one row: what's coming in, what the crew costs, what you keep. */
function WeekStrip({ week, fees, calls, toCollect }: { week: DayTotals; fees: number; calls: number; toCollect: ScheduleJob[] }) {
  const collect = toCollect.reduce((s, j) => s + (j.quote?.priceTotal ?? 0), 0)
  const tiles: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "warn" }[] = [
    { label: "Revenue", value: usd(week.price), hint: `${week.jobs} job${week.jobs === 1 ? "" : "s"}` },
    { label: "Crew pay", value: usd(week.labor), hint: week.crew.length ? `${week.crew.length} on the crew` : "owners only" },
    ...(fees > 0 ? [{ label: "Card fees", value: usd(fees) }] : []),
    { label: "Take-home", value: usd(week.profit), hint: week.price > 0 ? `${Math.round((week.profit / week.price) * 100)}% of revenue` : undefined, tone: week.profit < 0 ? "bad" : "good" },
    { label: "Hours on site", value: hrs(week.hours), hint: week.hours > 0 ? `${usd(Math.round(week.profit / week.hours))}/h take-home` : undefined },
    {
      label: "To do",
      value: `${calls + toCollect.length}`,
      hint: [calls ? `${calls} call${calls === 1 ? "" : "s"}` : null, toCollect.length ? `collect ${usd(collect)}` : null].filter(Boolean).join(" · ") || "all clear",
      tone: calls + toCollect.length ? "warn" : undefined,
    },
  ]
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              "rounded-lg border bg-white px-3 py-2 shadow-sm",
              t.tone === "good" ? "border-brand-green-dark/40 bg-brand-green/10" : t.tone === "warn" ? "border-amber-400 bg-amber-50" : t.tone === "bad" ? "border-destructive/40 bg-red-50" : "border-ink/10",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t.label}</p>
            <p className={cn("text-xl font-bold leading-tight tabular-nums text-ink", t.tone === "bad" && "text-destructive")}>{t.value}</p>
            {t.hint ? <p className="truncate text-xs text-ink-muted">{t.hint}</p> : null}
          </div>
        ))}
      </div>
      {week.crew.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <Users className="size-3.5" aria-hidden="true" />
          <span className="font-semibold text-ink">Crew hours this week:</span>
          {week.crew.map((c) => (
            <span key={c.id} className="rounded-full bg-gray-light px-2 py-0.5 font-medium text-ink">
              {c.name.split(" ")[0]} {hrs(c.hours)}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}

/** Day name, then that day's money and who's working how long. */
function DayHeader({ day, totals: t, shrunk }: { day: ScheduleDay; totals: DayTotals | undefined; shrunk: boolean }) {
  return (
    <header className={cn("border-b border-ink/10 px-2 py-1.5", day.isToday && "bg-brand-green/15")}>
      <p className="flex items-baseline justify-between gap-1">
        <span className="whitespace-nowrap text-sm font-bold text-ink">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{day.weekday}</span>
          {day.label}
        </span>
        {t && t.jobs ? (
          <span className="text-[11px] text-ink-muted">
            {t.jobs} job{t.jobs === 1 ? "" : "s"} · {hrs(t.hours)}
          </span>
        ) : null}
      </p>
      {t && t.jobs && !shrunk ? (
        <>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums" title="Revenue · crew pay · take-home">
            <span className="font-semibold text-ink">{usd(t.price)}</span>
            <span className="text-ink-muted">−{usd(t.labor)} crew</span>
            <span className={cn("font-bold", t.profit < 0 ? "text-destructive" : "text-brand-green-dark")}>={usd(t.profit)}</span>
          </p>
          {t.crew.length ? (
            <p className="mt-0.5 truncate text-[11px] text-ink-muted" title={t.crew.map((c) => `${c.name} ${hrs(c.hours)}`).join(", ")}>
              {t.crew.map((c) => `${c.name.split(" ")[0]} ${hrs(c.hours)}`).join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}
      {day.routes.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          className={cn(
            "mt-1 block truncate rounded px-1 py-0.5 text-[11px] font-semibold",
            r.kind === "snow" ? "bg-sky-100 text-sky-900 hover:bg-sky-200" : "bg-brand-green/25 text-ink hover:bg-brand-green/40",
          )}
          title={`${r.kind === "snow" ? "Snow" : "Mowing"} route ${r.label}`}
        >
          {r.kind === "snow" ? "❄" : "🌱"} {r.label}
        </Link>
      ))}
    </header>
  )
}

/**
 * One job, everything at a glance: time and length, customer and price, services, who's on it, and the
 * money (crew pay, card fee if they pay by card, take-home). Tap for the full panel; drag to move.
 */
function JobCard({
  job,
  at,
  rail = false,
  faded = false,
  disabled,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  job: ScheduleJob
  at: Placement | null
  rail?: boolean
  faded?: boolean
  disabled: boolean
  onOpen: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const look = LOOK[job.status]
  const locked = LOCKED_STATUSES.includes(job.status)
  const crew = crewLine(job)
  const m = job.money
  const collect = job.status === "done" && job.quote && !job.quote.paidAt
  return (
    <button
      type="button"
      data-card={rail ? undefined : ""}
      draggable={!locked && !disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={`${job.customerName} · ${STATUS_LABEL[job.status]}${job.address ? ` · ${job.address}` : ""}`}
      className={cn(
        "block w-full rounded-md border border-l-4 border-ink/10 px-2 py-1.5 text-left text-xs leading-snug shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
        look.edge,
        look.bg,
        !locked && "cursor-grab active:cursor-grabbing",
        faded && "opacity-60",
      )}
      style={job.weatherHold ? HATCH_STYLE : undefined}
    >
      <span className="flex items-center gap-1">
        {rail ? <GripVertical className="-ml-1 size-3.5 shrink-0 text-ink-muted" aria-hidden="true" /> : null}
        <span className="font-semibold tabular-nums text-ink">{at ? timeRange(at.startMin, at.endMin) : hrs(job.hours)}</span>
        {at ? <span className="text-ink-muted">· {hrs(job.hours)}</span> : <span className="text-ink-muted">· {job.crewSize} crew</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {job.weatherHold ? <span aria-label="Weather hold">⛈</span> : null}
          {collect ? (
            <span className="rounded bg-amber-200 px-1 text-[10px] font-bold uppercase text-amber-950">Collect</span>
          ) : rail ? null : (
            <span className={cn("rounded px-1 text-[10px] font-bold uppercase", look.pill)}>
              {look.word === "Call" ? <Phone className="mr-0.5 inline size-2.5" aria-hidden="true" /> : null}
              {look.word}
            </span>
          )}
        </span>
      </span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-bold text-ink", job.status === "cancelled" && "line-through")}>{job.customerName}</span>
        {m.price > 0 ? <span className="shrink-0 font-bold tabular-nums text-ink">{usd(m.price)}</span> : null}
      </span>
      {job.services.length ? <span className="block truncate text-ink-muted">{job.services.join(", ")}</span> : null}
      <span className={cn("mt-0.5 flex items-center gap-1 truncate", crew.warn ? "font-semibold text-amber-900" : "text-ink")}>
        {job.ownersWorking ? <Crown className="size-3 shrink-0" aria-hidden="true" /> : crew.warn ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : <Users className="size-3 shrink-0 text-ink-muted" aria-hidden="true" />}
        <span className="truncate">{crew.text}</span>
      </span>
      {m.price > 0 || m.labor > 0 ? (
        <span className="mt-1 flex items-end justify-between gap-1 border-t border-ink/10 pt-1 tabular-nums">
          <span className="min-w-0 text-ink-muted">
            <span className="whitespace-nowrap">{m.labor > 0 ? `crew ${usd(m.labor)}${m.basis === "estimate" ? "*" : ""}` : job.ownersWorking ? "no crew pay" : "crew $0"}</span>
            {m.fee > 0 ? <span className="whitespace-nowrap"> · card {usd(m.fee)}</span> : null}
          </span>
          <span className={cn("shrink-0 font-bold", m.profit < 0 ? "text-destructive" : "text-brand-green-dark")} title="Take-home">
            {usd(m.profit)}
          </span>
        </span>
      ) : null}
    </button>
  )
}
