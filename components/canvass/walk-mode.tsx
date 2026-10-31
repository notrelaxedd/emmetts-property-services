"use client"

import { AlertTriangle, CloudOff, Footprints, LocateFixed, MapPinOff, PartyPopper, RefreshCw } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { logKnockAction } from "@/app/crew/actions/knock"
import { startWalkAction } from "@/app/crew/actions/walk"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { WalkResultView, WalkStopView } from "@/lib/canvass/views"
import { excludeLogged, nextStopIndex, priceServiceLabel } from "@/lib/canvass/walk-links"
import type { KnockOutcome } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { ComebackPicker } from "./comeback-picker"
import { NextCard } from "./next-card"
import { OutcomeButtons, WALK_OUTCOME_LABEL } from "./outcome-buttons"
import { enqueueKnock, flushQueue, newClientId, readQueue, type FlushEvent, type LogKnockInput } from "./offline-queue"
import { ProgressBar } from "./progress-bar"
import { useGeolocation } from "./use-geolocation"

const WalkMap = dynamic(() => import("./walk-map").then((m) => m.WalkMap), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse rounded-lg bg-gray-light" aria-hidden="true" />,
})

/** Same key the v2 knock screen used, so a crew member's pick carries over. */
const PITCH_KEY = "canvass.pitch"
const lastPosKey = (profileId: string) => `canvass.walk.lastPos.${profileId}`

type Phase = "idle" | "locating" | "denied" | "loading" | "walking" | "finished" | "error"
type Point = { lat: number; lng: number }
type LastLog = { client_id: string; address: string; outcome: KnockOutcome; status: "queued" | "sent" | "failed" }
/** A remembered fix and when it was taken (epoch ms). */
type StoredPoint = Point & { at: number }

/** A remembered fix older than this is not offered: the crew member is likely somewhere else by now. */
const LAST_POS_MAX_AGE_MS = 60 * 60_000
/** A re-plan that has not answered by then is given up on (a dead zone often still reports "online"). */
const PLAN_TIMEOUT_MS = 15_000
/** Taps on the outcome grid are ignored this long after the screen moves on, so a double tap can't log the next house. */
const TAP_GUARD_MS = 600

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable: the value lasts for this screen only
  }
}

/** The remembered fix, or null when there is none, it has no time (an older copy) or it is over an hour old. */
function readLastPos(profileId: string, now = Date.now()): StoredPoint | null {
  const raw = readStored(lastPosKey(profileId))
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<StoredPoint>
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return null
    if (typeof v.at !== "number" || !Number.isFinite(v.at) || now - v.at > LAST_POS_MAX_AGE_MS || v.at > now + 60_000) return null
    return { lat: v.lat, lng: v.lng, at: v.at }
  } catch {
    return null
  }
}

function minutesAgo(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000))
  return m <= 1 ? "just now" : `${m} min ago`
}

export type WalkModeProps = {
  profileId: string
  name: string
  /** "crew" sits above the crew tab bar; "owner" is inside the admin shell. */
  variant?: "crew" | "owner"
}

/**
 * Walk Mode: "Start walking" takes a GPS fix, asks the server for the next good doors in walking order, then shows
 * one house at a time with six outcome buttons. Logging goes through the offline queue (works without signal) and
 * the screen moves on at once. Crew never see score points, profit or labor cost: the walk only carries what the card shows.
 */
export function WalkMode({ profileId, name, variant = "crew" }: WalkModeProps) {
  const { toast } = useToast()
  const [watching, setWatching] = React.useState(false)
  const geo = useGeolocation(watching)

  const [phase, setPhase] = React.useState<Phase>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [walk, setWalk] = React.useState<WalkResultView | null>(null)
  const [stops, setStops] = React.useState<WalkStopView[]>([])
  const [index, setIndex] = React.useState(0)
  const [start, setStart] = React.useState<Point | null>(null)
  const [fallbackPos, setFallbackPos] = React.useState<Point | null>(null)
  const [lastKnown, setLastKnown] = React.useState<StoredPoint | null>(null)
  /** Every house logged this session (kept across re-plans), with its outcome. */
  const [outcomes, setOutcomes] = React.useState<Map<string, KnockOutcome>>(() => new Map())
  const [pitchId, setPitchId] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState(false)
  const [queued, setQueued] = React.useState(0)
  const [lastLog, setLastLog] = React.useState<LastLog | null>(null)
  const [replanning, setReplanning] = React.useState(false)

  const planning = React.useRef(false)
  const phaseRef = React.useRef(phase)
  phaseRef.current = phase
  const lockUntil = React.useRef(0)
  const outcomesRef = React.useRef(outcomes)
  outcomesRef.current = outcomes
  const positionRef = React.useRef<Point | null>(null)
  const pos: Point | null = geo.position ?? fallbackPos
  positionRef.current = pos

  // ---------- Offline queue ----------

  const onFlushEvent = React.useCallback(
    (e: FlushEvent) => {
      if (e.kind === "sent") {
        setLastLog((l) => (l && l.client_id === e.clientId ? { ...l, status: "sent" } : l))
        // The knock saved but its lead / quote did not (a booking with no lead): say so, the owner has to follow up.
        if (e.result.message.includes("not created")) toast({ title: e.result.message, variant: "destructive" })
      } else if (e.kind === "rejected") {
        setLastLog((l) => (l && l.client_id === e.clientId ? { ...l, status: "failed" } : l))
        toast({ title: `Knock not saved: ${e.error}`, variant: "destructive" })
      }
    },
    [toast],
  )

  const flush = React.useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setQueued(readQueue().length)
      return
    }
    try {
      await flushQueue(logKnockAction, onFlushEvent)
    } finally {
      setQueued(readQueue().length)
    }
  }, [onFlushEvent])

  React.useEffect(() => {
    setPitchId(readStored(PITCH_KEY))
    setLastKnown(readLastPos(profileId))
    setQueued(readQueue().length)
    void flush()
    const onOnline = () => void flush()
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush()
    }
    window.addEventListener("online", onOnline)
    document.addEventListener("visibilitychange", onVisible)
    // Items waiting on backoff get another go every 15 s.
    const timer = window.setInterval(() => {
      if (readQueue().length) void flush()
    }, 15_000)
    return () => {
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(timer)
    }
  }, [flush, profileId])

  // Remember the latest fix so a later "denied" screen can offer it.
  React.useEffect(() => {
    if (geo.position) writeStored(lastPosKey(profileId), JSON.stringify({ lat: geo.position.lat, lng: geo.position.lng, at: geo.position.at }))
  }, [geo.position, profileId])

  // ---------- Planning ----------

  const plan = React.useCallback(
    async (from: Point, replan: boolean) => {
      if (planning.current) return
      planning.current = true
      // Re-planning mid-walk keeps the current walk on screen (and loggable) until the new one arrives; a failure keeps it.
      const keepWalk = replan && phaseRef.current === "walking"
      const failed = (message: string) => {
        if (keepWalk) {
          toast({ title: `Couldn't re-plan: ${message}`, description: "Carry on with this walk and try again later.", variant: "destructive" })
        } else {
          setError(message)
          setPhase("error")
        }
      }
      if (keepWalk) setReplanning(true)
      else setPhase("loading")
      setError(null)
      try {
        // Re-plan: send what is still queued first so the server's "knocked recently" rule sees it too.
        if (replan) await flush()
        // Every house logged this session is left out on the server before it takes the top doors (some may still be queued).
        const res = await withTimeout(startWalkAction(from.lat, from.lng, Array.from(outcomesRef.current.keys())), PLAN_TIMEOUT_MS)
        if (!res.ok) {
          failed(res.error)
          return
        }
        const next = replan ? excludeLogged(res.walk.stops, new Set(outcomesRef.current.keys())) : res.walk.stops
        setWalk(res.walk)
        setStops(next)
        setStart(from)
        setIndex(0)
        setPicking(false)
        // The house under the crew member's finger just changed: a tap already on its way must not log the new one.
        if (keepWalk) lockUntil.current = Date.now() + TAP_GUARD_MS
        setPhase(next.length ? "walking" : "finished")
      } catch {
        failed("Couldn't reach the server. Check your signal and try again.")
      } finally {
        planning.current = false
        setReplanning(false)
      }
    },
    [flush, toast],
  )

  const startWalking = () => {
    setFallbackPos(null)
    setError(null)
    setPhase("locating")
    if (watching) geo.retry()
    else setWatching(true)
  }

  // A fix arrived while we were waiting for one: plan from it.
  React.useEffect(() => {
    if (phase !== "locating") return
    if (geo.position) {
      void plan({ lat: geo.position.lat, lng: geo.position.lng }, false)
    } else if (geo.status === "denied" || geo.status === "unavailable" || geo.status === "timeout" || geo.status === "unsupported") {
      setPhase("denied")
    }
  }, [phase, geo.position, geo.status, plan])

  const useLastKnown = () => {
    if (!lastKnown) return
    setFallbackPos(lastKnown)
    void plan(lastKnown, false)
  }

  const replan = () => {
    const from = positionRef.current ?? start
    if (!from) return
    void plan(from, true)
  }

  // ---------- Logging (no awaits before the optimistic state) ----------

  const current: WalkStopView | null = stops[index] ?? null
  const doneIds = React.useMemo(() => new Set(stops.filter((s) => outcomes.has(s.id)).map((s) => s.id)), [stops, outcomes])
  /** Booked across the whole session (the "Walk complete" line). */
  const sessionBooked = React.useMemo(() => Array.from(outcomes.values()).filter((o) => o === "booked").length, [outcomes])
  /** Booked among this walk's stops (the progress line, next to this walk's "8 of 25"). */
  const walkBooked = React.useMemo(() => stops.filter((s) => outcomes.get(s.id) === "booked").length, [stops, outcomes])

  const tapLocked = () => Date.now() < lockUntil.current
  const lockTaps = () => {
    lockUntil.current = Date.now() + TAP_GUARD_MS
  }

  const advance = (done: ReadonlySet<string>) => {
    const next = nextStopIndex(stops, done, index)
    setPicking(false)
    lockTaps()
    if (next === null) setPhase("finished")
    else setIndex(next)
  }

  const logOutcome = (outcome: KnockOutcome, callbackWindow?: string) => {
    const stop = current
    if (!stop || tapLocked()) return
    // Only a live fix is the knock's location; a remembered "last known" point could be another street entirely.
    const fix = geo.position
    const input: LogKnockInput = {
      client_id: newClientId(),
      parcel_id: stop.id,
      outcome,
      knocked_at: new Date().toISOString(),
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      pitch_id: pitchId,
      // quote_low / quote_high are left off: the server fills in the tier price for quote_given and booked.
      callback_window: callbackWindow ?? null,
    }
    setOutcomes((prev) => new Map(prev).set(stop.id, outcome))
    setLastLog({ client_id: input.client_id, address: stop.fullAddress, outcome, status: "queued" })
    setQueued(enqueueKnock(input).length)
    void flush()
    const done = new Set(doneIds)
    done.add(stop.id)
    advance(done)
  }

  const onPick = (outcome: KnockOutcome) => {
    if (tapLocked()) return
    if (outcome === "call_back") {
      setPicking(true)
      lockTaps()
    } else logOutcome(outcome)
  }

  const skip = () => {
    if (!tapLocked()) advance(doneIds)
  }

  const backToWalk = () => {
    const next = nextStopIndex(stops, doneIds, -1)
    setError(null)
    if (next === null) setPhase("finished")
    else {
      setIndex(next)
      setPhase("walking")
    }
  }

  const changePitch = (id: string | null) => {
    setPitchId(id)
    writeStored(PITCH_KEY, id)
  }

  // ---------- Render ----------

  const pitchScript = walk?.pitches.find((p) => p.id === pitchId)?.script?.trim() || null
  const serviceLabel = walk ? priceServiceLabel(walk.season.service) : ""
  const remaining = stops.length - doneIds.size
  const queuedChip =
    queued > 0 ? (
      <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-amber-200 px-3 text-xs font-semibold text-amber-950">
        <CloudOff className="size-3.5" aria-hidden="true" />
        {queued} queued
      </span>
    ) : null

  if (phase === "idle" || phase === "locating" || phase === "loading") {
    const busy = phase !== "idle"
    return (
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-white p-4">
          <div className="flex items-center gap-2">
            <Footprints className="size-5 text-brand-green-dark" aria-hidden="true" />
            <h1 className="text-lg font-bold text-ink">Walk Mode</h1>
          </div>
          <p className="text-sm text-ink-muted">
            {name ? `${name.split(" ")[0]}, ` : ""}we&rsquo;ll find the next good doors near you and put them in walking order. Tap an outcome at each door and
            it moves on to the next house.
          </p>
          <Button
            type="button"
            onClick={startWalking}
            disabled={busy}
            className="h-14 w-full rounded-xl bg-brand-green text-base font-bold text-ink shadow-none hover:bg-brand-green-dark hover:text-white"
          >
            <LocateFixed className="!size-5" aria-hidden="true" />
            {phase === "locating" ? "Finding you..." : phase === "loading" ? "Planning your walk..." : "Start walking"}
          </Button>
          {queuedChip}
        </section>
      </div>
    )
  }

  if (phase === "denied") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <MapPinOff aria-hidden="true" />
          <AlertTitle>We couldn&rsquo;t get your location</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            {geo.status === "timeout" || geo.status === "unavailable" ? (
              <span>
                Your phone hasn&rsquo;t found a GPS fix yet. Step away from tall buildings or wait a few seconds, then try again.
              </span>
            ) : (
              <span>
                Walk Mode plans the route from where you&rsquo;re standing. Allow location for this site in your browser settings (it&rsquo;s only used while
                this screen is open), then try again.
              </span>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={startWalking}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
              {lastKnown ? (
                <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={useLastKnown}>
                  <LocateFixed aria-hidden="true" />
                  Use last known location ({minutesAgo(lastKnown.at)})
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Couldn&rsquo;t plan the walk</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{error ?? "Something went wrong."}</span>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-base"
            onClick={() => {
              const from = positionRef.current ?? start
              if (from) void plan(from, stops.length > 0 || outcomes.size > 0)
              else startWalking()
            }}
          >
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          {stops.length > 0 ? (
            <Button type="button" variant="ghost" className="h-12 w-full text-base" onClick={backToWalk}>
              Back to my walk
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (phase === "finished" || !current) {
    return (
      <div className="flex flex-col gap-3">
        <section className="flex flex-col items-center gap-3 rounded-xl border border-ink/10 bg-white p-5 text-center">
          <PartyPopper className="size-8 text-brand-green-dark" aria-hidden="true" />
          <h1 className="text-lg font-bold text-ink">{outcomes.size ? "Walk complete" : "No good doors nearby"}</h1>
          <p className="text-sm text-ink-muted">
            {outcomes.size
              ? `${outcomes.size} ${outcomes.size === 1 ? "door" : "doors"} logged${sessionBooked ? `, ${sessionBooked} booked` : ""}.`
              : "Nothing nearby looks good to knock right now. Try again from another street, or later in the day."}
          </p>
          {queuedChip}
          <Button type="button" onClick={replan} disabled={!positionRef.current && !start} className="h-12 w-full text-base">
            <RefreshCw aria-hidden="true" />
            Plan another walk from here
          </Button>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar total={stops.length} handled={doneIds.size} booked={walkBooked} />
        </div>
        {queuedChip}
      </div>

      <WalkMap stops={stops} doneIds={doneIds} currentId={current.id} position={pos} start={start} />

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="walk-pitch" className="sr-only">
            Pitch
          </label>
          <NativeSelect id="walk-pitch" className="h-11 text-base" value={pitchId ?? ""} onChange={(e) => changePitch(e.target.value || null)}>
            <option value="">Pick a pitch</option>
            {(walk?.pitches ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 px-3 text-sm" onClick={replan} disabled={replanning} aria-busy={replanning}>
          <RefreshCw aria-hidden="true" className={cn(replanning && "animate-spin")} />
          {replanning ? "Re-planning..." : "Re-plan"}
        </Button>
      </div>

      {lastLog ? (
        <p className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className="min-w-0 truncate">
            <span className="font-semibold text-ink">{WALK_OUTCOME_LABEL[lastLog.outcome] ?? lastLog.outcome}</span> · {lastLog.address}
          </span>
          <span
            className={cn(
              "shrink-0 font-semibold",
              lastLog.status === "sent" ? "text-brand-green-dark" : lastLog.status === "failed" ? "text-destructive" : "text-amber-700",
            )}
          >
            {lastLog.status === "sent" ? "Saved" : lastLog.status === "failed" ? "Not saved" : "Queued"}
          </span>
        </p>
      ) : null}

      <section
        aria-label="Next house"
        className={cn(
          "sticky z-10 flex flex-col gap-3 rounded-xl border border-ink/15 bg-white p-3 shadow-lg",
          variant === "crew" ? "bottom-[calc(4.25rem+env(safe-area-inset-bottom))]" : "bottom-2",
        )}
      >
        <NextCard stop={current} pitch={pitchScript ?? current.pitch} serviceLabel={serviceLabel} onSkip={skip} canSkip={remaining > 1} />
        {picking ? (
          <ComebackPicker onConfirm={(w) => logOutcome("call_back", w)} onCancel={() => !tapLocked() && setPicking(false)} />
        ) : (
          <OutcomeButtons onPick={onPick} />
        )}
      </section>
    </div>
  )
}
