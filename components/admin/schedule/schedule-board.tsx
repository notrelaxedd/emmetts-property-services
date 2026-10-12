"use client"

import * as React from "react"
import { CloudLightning, Play } from "lucide-react"
import { moveJob, runScheduler } from "@/app/admin/actions/schedule"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { zonedToUtc } from "@/lib/scheduler/time"
import { cn } from "@/lib/utils"
import { JobDialog } from "./job-dialog"
import { fmtDuration, fmtMinutes, hhmm, HATCH_STYLE, LOCKED_STATUSES, STATUS_LABEL, STATUS_STYLE } from "./status"
import type { ScheduleDay, ScheduleJob } from "./types"

const DAY_START = 7 * 60
const DAY_END = 20 * 60
const SLOT = 30
const SLOT_H = 24
const GRID_H = ((DAY_END - DAY_START) / SLOT) * SLOT_H
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60)

type Placed = { job: ScheduleJob; startMin: number; endMin: number; lane: number; lanes: number }

/** Side-by-side lanes for overlapping blocks within one day. */
function layoutDay(jobs: { job: ScheduleJob; startMin: number; endMin: number }[]): Placed[] {
  const sorted = [...jobs].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -1
  let laneEnds: number[] = []
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }
  for (const j of sorted) {
    if (cluster.length && j.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= j.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(j.endMin)
    } else laneEnds[lane] = j.endMin
    cluster.push({ ...j, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, j.endMin)
  }
  flush()
  return out
}

const LEGEND: { label: string; className: string; hatch?: boolean }[] = [
  { label: "Proposed", className: STATUS_STYLE.proposed },
  { label: "Crew confirmed", className: STATUS_STYLE.crew_confirmed },
  { label: "Booked", className: STATUS_STYLE.booked },
  { label: "In progress", className: STATUS_STYLE.in_progress },
  { label: "Done", className: STATUS_STYLE.done },
  { label: "Cancelled", className: STATUS_STYLE.cancelled },
  { label: "Weather hold", className: "border border-ink/30 bg-white", hatch: true },
]

export function ScheduleBoard({
  days,
  jobs,
  unscheduled,
  hasWindows,
}: {
  days: ScheduleDay[]
  jobs: ScheduleJob[]
  unscheduled: ScheduleJob[]
  hasWindows: boolean
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hover, setHover] = React.useState<{ date: string; startMin: number; endMin: number } | null>(null)
  const [moved, setMoved] = React.useState<Record<string, { date: string; startMin: number; endMin: number }>>({})
  const drag = React.useRef<{ id: string; grabPx: number; duration: number } | null>(null)

  const allJobs = React.useMemo(() => [...jobs, ...unscheduled], [jobs, unscheduled])
  const selected = allJobs.find((j) => j.id === selectedId) ?? null

  const move = React.useCallback(
    (job: ScheduleJob, date: string, startMin: number) => {
      const duration = (job.endMin ?? 0) - (job.startMin ?? 0) || job.estMinutes || SLOT
      if (job.date === date && job.startMin === startMin) return
      setMoved((m) => ({ ...m, [job.id]: { date, startMin, endMin: startMin + duration } }))
      startTransition(async () => {
        const iso = zonedToUtc(date, hhmm(startMin)).toISOString()
        const res = await moveJob(job.id, iso)
        setMoved((m) => {
          const next = { ...m }
          delete next[job.id]
          return next
        })
        if (res.ok) toast({ title: res.message ?? "Job moved.", variant: "success" })
        else toast({ title: "Can't move that job", description: res.reason, variant: "destructive" })
      })
    },
    [toast],
  )

  const slotFromEvent = (e: React.DragEvent<HTMLDivElement>): number | null => {
    if (!drag.current) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top - drag.current.grabPx
    const raw = DAY_START + Math.round(y / SLOT_H) * SLOT
    const latest = Math.max(DAY_START, DAY_END - drag.current.duration)
    return Math.min(latest, Math.max(DAY_START, raw))
  }

  const placedByDay = React.useMemo(() => {
    const map = new Map<string, Placed[]>()
    for (const d of days) {
      const items = jobs
        .map((job) => {
          const m = moved[job.id]
          const date = m?.date ?? job.date
          const startMin = m?.startMin ?? job.startMin
          const endMin = m?.endMin ?? job.endMin
          if (date !== d.date || startMin === null || endMin === null) return null
          const s = Math.max(DAY_START, startMin)
          const e = Math.min(DAY_END, Math.max(endMin, s + SLOT / 2))
          return { job, startMin: s, endMin: Math.max(e, s + SLOT / 2) }
        })
        .filter((x): x is { job: ScheduleJob; startMin: number; endMin: number } => x !== null)
      map.set(d.date, layoutDay(items))
    }
    return map
  }, [days, jobs, moved])

  const outsideGrid = jobs.filter(
    (j) => j.startMin !== null && j.endMin !== null && (j.endMin <= DAY_START || j.startMin >= DAY_END),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted" aria-label="Legend">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-5 rounded-sm", l.className)} style={l.hatch ? HATCH_STYLE : undefined} />
            {l.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm border border-ink/10 bg-brand-green/15" />
          Your open hours
        </span>
        {pending ? <span className="font-semibold text-ink">Saving…</span> : null}
      </div>

      {!hasWindows ? (
        <p className="rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950">
          You haven&apos;t set any open hours yet, so jobs can&apos;t be placed or moved. Add them on the Availability page.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_17rem]">
        <Card className="min-w-0 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              {/* Header row */}
              <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-ink/10 bg-white">
                <div />
                {days.map((d) => (
                  <div
                    key={d.date}
                    className={cn("border-l border-ink/10 px-2 py-2 text-center", d.isToday && "bg-brand-green/15")}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{d.weekday}</p>
                    <p className="text-sm font-semibold text-ink">{d.label}</p>
                    {d.closed ? (
                      <p className="text-[11px] font-medium text-destructive">Closed</p>
                    ) : d.note ? (
                      <p className="truncate text-[11px] text-ink-muted" title={d.note}>
                        {d.note}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Body */}
              <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
                <div className="relative" style={{ height: GRID_H }}>
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-ink-muted"
                      style={{ top: ((h - DAY_START) / SLOT) * SLOT_H }}
                    >
                      {h === DAY_START ? "" : fmtMinutes(h)}
                    </span>
                  ))}
                </div>
                {days.map((d) => {
                  const placed = placedByDay.get(d.date) ?? []
                  return (
                    <div
                      key={d.date}
                      className="relative border-l border-ink/10 bg-gray-light/60"
                      style={{ height: GRID_H }}
                      onDragOver={(e) => {
                        const startMin = slotFromEvent(e)
                        if (startMin === null || !drag.current) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = "move"
                        if (hover?.date !== d.date || hover.startMin !== startMin) {
                          setHover({ date: d.date, startMin, endMin: startMin + drag.current.duration })
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const startMin = slotFromEvent(e)
                        const id = drag.current?.id
                        drag.current = null
                        setHover(null)
                        const job = jobs.find((j) => j.id === id)
                        if (job && startMin !== null) move(job, d.date, startMin)
                      }}
                    >
                      {/* Owner open hours */}
                      {d.open.map((o, i) => {
                        const s = Math.max(DAY_START, o.startMin)
                        const e = Math.min(DAY_END, o.endMin)
                        if (e <= s) return null
                        return (
                          <div
                            key={i}
                            aria-hidden="true"
                            className="absolute inset-x-0 bg-white"
                            style={{ top: ((s - DAY_START) / SLOT) * SLOT_H, height: ((e - s) / SLOT) * SLOT_H }}
                          >
                            <div className="size-full bg-brand-green/10" />
                          </div>
                        )
                      })}
                      {/* Grid lines */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0"
                        style={{
                          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${SLOT_H * 2 - 1}px, rgba(11,11,11,0.10) ${SLOT_H * 2 - 1}px ${SLOT_H * 2}px), repeating-linear-gradient(to bottom, transparent 0 ${SLOT_H - 1}px, rgba(11,11,11,0.04) ${SLOT_H - 1}px ${SLOT_H}px)`,
                        }}
                      />
                      {/* Drop preview */}
                      {hover && hover.date === d.date ? (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-ink/60 bg-ink/5"
                          style={{
                            top: ((hover.startMin - DAY_START) / SLOT) * SLOT_H,
                            height: (Math.min(DAY_END, hover.endMin) - hover.startMin) / SLOT * SLOT_H,
                          }}
                        >
                          <span className="m-1 inline-block rounded bg-ink px-1 text-[11px] font-semibold text-white">
                            {fmtMinutes(hover.startMin)}
                          </span>
                        </div>
                      ) : null}
                      {/* Jobs */}
                      {placed.map((p) => {
                        const locked = LOCKED_STATUSES.includes(p.job.status)
                        const height = ((p.endMin - p.startMin) / SLOT) * SLOT_H
                        return (
                          <button
                            key={p.job.id}
                            type="button"
                            draggable={!locked && !pending}
                            onDragStart={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              drag.current = {
                                id: p.job.id,
                                grabPx: e.clientY - rect.top,
                                duration: (p.job.endMin ?? 0) - (p.job.startMin ?? 0) || p.job.estMinutes || SLOT,
                              }
                              e.dataTransfer.effectAllowed = "move"
                              e.dataTransfer.setData("text/plain", p.job.id)
                            }}
                            onDragEnd={() => {
                              drag.current = null
                              setHover(null)
                            }}
                            onClick={() => setSelectedId(p.job.id)}
                            title={`${p.job.customerName} · ${STATUS_LABEL[p.job.status]}${p.job.weatherHold ? " · weather hold" : ""}`}
                            className={cn(
                              "absolute z-20 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                              STATUS_STYLE[p.job.status],
                              !locked && "cursor-grab active:cursor-grabbing",
                              moved[p.job.id] && "opacity-70",
                            )}
                            style={{
                              top: ((p.startMin - DAY_START) / SLOT) * SLOT_H + 1,
                              height: Math.max(height - 2, 18),
                              left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                              width: `calc(${100 / p.lanes}% - 4px)`,
                              ...(p.job.weatherHold ? HATCH_STYLE : {}),
                            }}
                          >
                            <span className="flex items-center gap-1 font-semibold">
                              {p.job.weatherHold ? <span aria-label="Weather hold">⛈</span> : null}
                              <span className="truncate">{p.job.customerName}</span>
                            </span>
                            {height >= 40 && p.job.services.length ? (
                              <span className="block truncate opacity-90">{p.job.services.join(", ")}</span>
                            ) : null}
                            {height >= 56 && p.job.crew.length ? (
                              <span className="mt-0.5 flex gap-0.5">
                                {p.job.crew.map((c) => (
                                  <span
                                    key={c.id}
                                    title={`${c.name} (${c.status})`}
                                    className={cn(
                                      "inline-flex size-5 items-center justify-center rounded-full bg-ink/80 text-[9px] font-bold text-white no-underline",
                                      c.status === "offered" && "bg-white text-ink ring-1 ring-ink/40",
                                    )}
                                  >
                                    {c.initials}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          {outsideGrid.length ? (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">
              {outsideGrid.length} job{outsideGrid.length === 1 ? "" : "s"} fall outside 7am–8pm; see the list below.
            </p>
          ) : null}
        </Card>

        {/* Unscheduled rail */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Waiting for a slot</CardTitle>
            <CardDescription>Paid jobs the scheduler hasn&apos;t placed yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {unscheduled.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing waiting.</p>
            ) : (
              unscheduled.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setSelectedId(j.id)}
                  className={cn("block w-full rounded-md px-2.5 py-2 text-left text-sm", STATUS_STYLE.unscheduled)}
                  style={j.weatherHold ? HATCH_STYLE : undefined}
                >
                  <span className="flex items-center gap-1 font-semibold text-ink">
                    {j.weatherHold ? <span aria-label="Weather hold">⛈</span> : null}
                    {j.customerName}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {j.services.join(", ") || "Services"} · {fmtDuration(j.estMinutes)} · {j.crewSize} crew
                  </span>
                </button>
              ))
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await runScheduler()
                  toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: "Couldn't start the scheduler", description: r.reason, variant: "destructive" })
                })
              }
            >
              <Play /> Run scheduler now
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* List view (also the keyboard / mobile path to every job) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">This week</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {jobs.length === 0 ? (
            <EmptyState className="m-4" icon={CloudLightning} title="No jobs this week" description="Scheduled jobs show up here and on the grid above." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Services</TableHead>
                  <TableHead className="hidden sm:table-cell">Crew</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap">{j.whenLabel ?? "—"}</TableCell>
                    <TableCell className={cn("font-medium text-ink", j.status === "cancelled" && "line-through")}>{j.customerName}</TableCell>
                    <TableCell className="hidden max-w-[16rem] truncate md:table-cell">{j.services.join(", ") || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{j.crew.map((c) => c.initials).join(" ") || "—"}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={j.status === "booked" ? "success" : j.status === "proposed" ? "warning" : "outline"}>
                          {STATUS_LABEL[j.status]}
                        </Badge>
                        {j.weatherHold ? <Badge variant="outline">⛈ Hold</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(j.id)}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <JobDialog
        job={selected}
        days={days}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onMove={(date, startMin) => selected && move(selected, date, startMin)}
      />
    </div>
  )
}
