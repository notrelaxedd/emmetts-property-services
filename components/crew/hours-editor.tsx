"use client"

import { AlertCircle, Loader2, PauseCircle, Plus, Trash2 } from "lucide-react"
import * as React from "react"
import { saveAvailability, saveMaxHours, setPaused } from "@/app/crew/actions/hours"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NumberStepper } from "@/components/ui/number-stepper"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

export type Block = { start_time: string; end_time: string }
export type DayBlocks = Record<number, Block[]>

/** Monday-first, like a work week. Values are JS weekdays (0 = Sunday). */
const WEEK: { day: number; label: string }[] = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
]

const DEFAULT_BLOCK: Block = { start_time: "08:00", end_time: "17:00" }
const DEBOUNCE_MS = 800

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}
const validBlock = (b: Block) => /^\d{2}:\d{2}$/.test(b.start_time) && /^\d{2}:\d{2}$/.test(b.end_time) && toMin(b.start_time) < toMin(b.end_time)

function totalHours(days: DayBlocks): number {
  let mins = 0
  for (const blocks of Object.values(days)) for (const b of blocks) if (validBlock(b)) mins += toMin(b.end_time) - toMin(b.start_time)
  return Math.round((mins / 60) * 10) / 10
}

type SaveState = "idle" | "saving" | "saved" | "error"

export function HoursEditor({
  initialDays,
  initialMaxHours,
  initialPaused,
}: {
  initialDays: DayBlocks
  initialMaxHours: number
  initialPaused: boolean
}) {
  const { toast } = useToast()
  const [days, setDays] = React.useState<DayBlocks>(initialDays)
  const [maxHours, setMaxHours] = React.useState(initialMaxHours)
  const [paused, setPausedState] = React.useState(initialPaused)
  const [state, setState] = React.useState<SaveState>("idle")
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const inflight = React.useRef(0)

  React.useEffect(() => {
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [])

  const save = React.useCallback(
    async (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, successToast?: string) => {
      inflight.current += 1
      setState("saving")
      try {
        const res = await fn()
        if (res.ok) {
          toast({ title: successToast ?? res.message ?? "Saved", variant: "success", duration: 1800 })
          if (inflight.current === 1) setState("saved")
        } else {
          toast({ title: res.error, variant: "destructive" })
          setState("error")
        }
      } catch {
        toast({ title: "Couldn't save. Check your signal and try again.", variant: "destructive" })
        setState("error")
      } finally {
        inflight.current -= 1
      }
    },
    [toast],
  )

  const debounce = (key: string, fn: () => void) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(fn, DEBOUNCE_MS)
  }

  const updateDay = (day: number, blocks: Block[], immediate = false) => {
    setDays((prev) => ({ ...prev, [day]: blocks }))
    const doSave = () => {
      if (!blocks.every(validBlock)) return // shown inline; saved once fixed
      void save(() => saveAvailability({ weekday: day, blocks }))
    }
    if (immediate) {
      clearTimeout(timers.current[`day-${day}`])
      doSave()
    } else {
      debounce(`day-${day}`, doSave)
    }
  }

  const total = totalHours(days)

  return (
    <div className="flex flex-col gap-4">
      <Card className={cn(paused && "border-amber-400 bg-amber-50")}>
        <CardContent className="flex items-center gap-3 pt-4">
          <PauseCircle className={cn("size-6 shrink-0", paused ? "text-amber-900" : "text-ink-muted")} aria-hidden="true" />
          <label htmlFor="pause-switch" className="min-w-0 flex-1 cursor-pointer">
            <span className="block font-semibold text-ink">Pause all new jobs</span>
            <span className="block text-sm text-ink-muted">
              {paused ? "You won't be offered anything new. Jobs you accepted still stand." : "Turn on when you need a break."}
            </span>
          </label>
          <span className="inline-flex min-h-11 items-center">
            <Switch
              id="pause-switch"
              checked={paused}
              onCheckedChange={(v) => {
                setPausedState(v)
                void save(() => setPaused(v))
              }}
            />
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <NumberStepper
            label="Most hours a week"
            value={maxHours}
            min={0}
            max={80}
            step={1}
            suffix="hrs"
            onChange={(v) => {
              setMaxHours(v)
              debounce("max", () => void save(() => saveMaxHours(v)))
            }}
          />
          <p className="text-sm text-ink-muted">
            Your blocks below add up to {total} h a week. We never schedule you past {maxHours} h.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">When you can work</h2>
        <SaveIndicator state={state} />
      </div>

      <ul className="flex flex-col gap-3">
        {WEEK.map(({ day, label }) => {
          const blocks = days[day] ?? []
          const on = blocks.length > 0
          const switchId = `day-${day}`
          return (
            <li key={day}>
              <Card>
                <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <label htmlFor={switchId} className="flex-1 cursor-pointer">
                    <span className="block font-semibold text-ink">{label}</span>
                    {!on ? <span className="block text-sm text-ink-muted">Off</span> : null}
                  </label>
                  <span className="inline-flex min-h-11 items-center">
                    <Switch
                      id={switchId}
                      checked={on}
                      onCheckedChange={(v) => updateDay(day, v ? [DEFAULT_BLOCK] : [], true)}
                      aria-label={`${label} available`}
                    />
                  </span>
                </div>
                {on ? (
                  <div className="flex flex-col gap-2 border-t border-ink/10 px-4 py-3">
                    {blocks.map((b, i) => {
                      const bad = !validBlock(b)
                      return (
                        <div key={i} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              aria-label={`${label} block ${i + 1} start`}
                              value={b.start_time}
                              step={900}
                              onChange={(e) =>
                                updateDay(
                                  day,
                                  blocks.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)),
                                )
                              }
                              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-white px-2 text-base tabular-nums text-ink shadow-sm aria-[invalid=true]:border-destructive"
                              aria-invalid={bad}
                            />
                            <span className="text-sm text-ink-muted" aria-hidden="true">
                              to
                            </span>
                            <input
                              type="time"
                              aria-label={`${label} block ${i + 1} end`}
                              value={b.end_time}
                              step={900}
                              onChange={(e) =>
                                updateDay(
                                  day,
                                  blocks.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)),
                                )
                              }
                              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-white px-2 text-base tabular-nums text-ink shadow-sm aria-[invalid=true]:border-destructive"
                              aria-invalid={bad}
                            />
                            <button
                              type="button"
                              onClick={() => updateDay(day, blocks.filter((_, j) => j !== i), true)}
                              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-ink/[0.06] hover:text-destructive"
                            >
                              <Trash2 className="size-5" aria-hidden="true" />
                              <span className="sr-only">Remove {label} block {i + 1}</span>
                            </button>
                          </div>
                          {bad ? (
                            <p className="flex items-center gap-1 text-sm text-destructive">
                              <AlertCircle className="size-4" aria-hidden="true" />
                              End time must be after the start time.
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                    {blocks.length < 8 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 justify-start px-2 text-brand-green-dark"
                        onClick={() => {
                          const last = blocks[blocks.length - 1]
                          const start = last && validBlock(last) ? last.end_time : "12:00"
                          const endMin = Math.min(toMin(start) + 120, 23 * 60 + 45)
                          const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`
                          updateDay(day, [...blocks, { start_time: start, end_time: end }], true)
                        }}
                      >
                        <Plus aria-hidden="true" />
                        Add a time block
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1 text-sm text-ink-muted" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    )
  if (state === "saved") return <span className="text-sm text-brand-green-dark" role="status">All changes saved</span>
  if (state === "error") return <span className="text-sm text-destructive" role="status">Not saved</span>
  return <span className="text-sm text-ink-muted">Saves automatically</span>
}
