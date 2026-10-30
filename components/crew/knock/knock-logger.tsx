"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import * as React from "react"
import { logKnockAction, nearbyParcelsAction, searchParcelsAction, updateKnockDetailsAction } from "@/app/crew/actions/knock"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { distanceMeters } from "@/lib/canvass/geometry"
import { followPick, needsRefetch, preselectIndex, type FollowState } from "@/lib/canvass/preselect"
import type { ServiceKey } from "@/lib/canvass/types"
import type { NearbyParcel, PlanStopView } from "@/lib/canvass/views"
import type { KnockOutcome, Pitch } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { DetailsSheet, type DetailsTarget } from "./details-sheet"
import { HousePicker } from "./house-picker"
import {
  enqueueKnock,
  flushQueue,
  newClientId,
  patchQueuedKnock,
  readQueue,
  type FlushEvent,
  type KnockDetailsPatch,
  type LogKnockInput,
} from "./offline-queue"
import { OUTCOME_LABEL } from "./outcome-grid"
import { OutcomeGrid } from "./outcome-grid"
import { SessionBar, readPitch, writePitch } from "./session-bar"
import { useGeolocation } from "./use-geolocation"

/** Rocky River base (opsConfig.defaultBase): used only to load the session info when GPS is off. */
const BASE = { lat: 41.4756, lng: -81.8396 }
const STOP_OUTCOMES: readonly KnockOutcome[] = ["no_soliciting", "do_not_return"]

type Season = { service: ServiceKey; label: string; pitch: string }
type Plan = { date: string; stops: PlanStopView[] }
type LogEntry = {
  client_id: string
  parcel_id: string
  address: string
  outcome: KnockOutcome
  status: "queued" | "sent" | "failed"
  knock_id: string | null
}

export type KnockLoggerProps = { name: string; profileId: string }

export function KnockLogger({ name }: KnockLoggerProps) {
  const { toast } = useToast()
  const geo = useGeolocation()

  const [parcels, setParcels] = React.useState<NearbyParcel[]>([])
  const [index, setIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [season, setSeason] = React.useState<Season | null>(null)
  const [pitches, setPitches] = React.useState<Pick<Pitch, "id" | "name" | "script">[]>([])
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [pitchId, setPitchId] = React.useState<string | null>(null)
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [queued, setQueued] = React.useState(0)
  const [details, setDetails] = React.useState<DetailsTarget | null>(null)
  const [savingDetails, setSavingDetails] = React.useState(false)

  /** Where houses were last loaded from (never set by the GPS-off load, which fetches no houses). */
  const lastQuery = React.useRef<{ lat: number; lng: number } | null>(null)
  const manualPick = React.useRef(false)
  const follow = React.useRef<FollowState>({ index: 0, candidate: 0, streak: 0 })
  const pendingDetails = React.useRef(new Map<string, KnockDetailsPatch>())
  // Latest state for callbacks that must not re-create on every render (flush, load).
  const logsRef = React.useRef(logs)
  logsRef.current = logs
  const parcelsRef = React.useRef(parcels)
  parcelsRef.current = parcels
  const indexRef = React.useRef(index)
  indexRef.current = index
  const detailsOpenRef = React.useRef(false)
  detailsOpenRef.current = details !== null

  // ---------- Offline queue ----------

  const onFlushEvent = React.useCallback(
    async (e: FlushEvent) => {
      if (e.kind === "sent") {
        const { knock_id, message, do_not_knock } = e.result
        setLogs((prev) => prev.map((l) => (l.client_id === e.clientId ? { ...l, status: "sent", knock_id } : l)))
        setDetails((d) => (d && d.client_id === e.clientId ? { ...d, status: "sent", knock_id } : d))
        if (do_not_knock) {
          const entry = logsRef.current.find((l) => l.client_id === e.clientId)
          if (entry) setParcels((prev) => prev.map((p) => (p.id === entry.parcel_id ? { ...p, do_not_knock: true } : p)))
        }
        if (!message.startsWith("Logged:")) toast({ title: message, variant: message.includes("not created") ? "destructive" : "success" })
        const late = pendingDetails.current.get(e.clientId)
        if (late) {
          pendingDetails.current.delete(e.clientId)
          try {
            const res = await updateKnockDetailsAction(knock_id, late)
            if (!res.ok) toast({ title: res.error, variant: "destructive" })
          } catch {
            toast({ title: "Details didn't save. Add them again from the owner console.", variant: "destructive" })
          }
        }
      } else if (e.kind === "rejected") {
        pendingDetails.current.delete(e.clientId)
        setLogs((prev) => prev.map((l) => (l.client_id === e.clientId ? { ...l, status: "failed" } : l)))
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
      await flushQueue(logKnockAction, (e) => void onFlushEvent(e))
    } finally {
      setQueued(readQueue().length)
    }
  }, [onFlushEvent])

  React.useEffect(() => {
    setPitchId(readPitch())
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
  }, [flush])

  // ---------- Nearby parcels ----------

  const load = React.useCallback(
    async (lat: number, lng: number, withHouses: boolean) => {
      setLoading(true)
      setLoadError(null)
      if (withHouses) lastQuery.current = { lat, lng }
      try {
        const res = await nearbyParcelsAction(lat, lng)
        if (!res.ok) {
          setLoadError(res.error)
          return
        }
        setSeason(res.season)
        setPitches(res.pitches)
        setPlan(res.plan)
        if (withHouses) {
          const next = res.parcels
          const current = parcelsRef.current[indexRef.current]
          let idx = manualPick.current && current ? next.findIndex((p) => p.id === current.id) : -1
          if (idx < 0) {
            manualPick.current = false
            idx = Math.max(0, preselectIndex(next, [lng, lat]))
          }
          setParcels(next)
          setIndex(idx)
        }
      } catch {
        setLoadError("Couldn't reach the server. Check your signal and try again.")
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  React.useEffect(() => {
    const pos = geo.position
    if (!pos) return
    const last = lastQuery.current
    if (last && !needsRefetch(distanceMeters([last.lng, last.lat], [pos.lng, pos.lat]), parcelsRef.current)) {
      // Same spot: follow the GPS point to the right house unless the crew picked one by hand or is adding details.
      // A neighbour must win a few fixes in a row first, so GPS noise on a lot line does not flip the selection.
      if (!manualPick.current && !detailsOpenRef.current) {
        const cur = indexRef.current
        const state = follow.current.index === cur ? follow.current : { index: cur, candidate: cur, streak: 0 }
        follow.current = followPick(state, preselectIndex(parcelsRef.current, [pos.lng, pos.lat]))
        if (follow.current.index !== cur) setIndex(follow.current.index)
      }
      return
    }
    void load(pos.lat, pos.lng, true)
  }, [geo.position, load])

  React.useEffect(() => {
    const noGps = geo.status === "denied" || geo.status === "unsupported" || geo.status === "unavailable"
    if (!noGps) return
    if (!lastQuery.current) void load(BASE.lat, BASE.lng, false)
    else setLoading(false)
  }, [geo.status, load])

  // ---------- Picking ----------

  const selected = parcels[index] ?? null
  const doneParcelIds = React.useMemo(() => new Set(logs.map((l) => l.parcel_id)), [logs])

  const pickIndex = (i: number) => {
    manualPick.current = true
    setIndex(i)
  }

  const selectParcel = (parcel: NearbyParcel) => {
    manualPick.current = true
    const at = parcelsRef.current.findIndex((p) => p.id === parcel.id)
    if (at >= 0) {
      setIndex(at)
      return
    }
    setParcels([parcel, ...parcelsRef.current])
    setIndex(0)
  }

  const search = async (q: string): Promise<NearbyParcel[]> => {
    try {
      const res = await searchParcelsAction(q)
      if (!res.ok) {
        toast({ title: res.error, variant: "destructive" })
        return []
      }
      return res.parcels
    } catch {
      toast({ title: "Couldn't reach the server. Check your signal and try again.", variant: "destructive" })
      return []
    }
  }

  const goTo = async (stop: PlanStopView) => {
    const at = parcels.findIndex((p) => p.id === stop.id)
    if (at >= 0) {
      pickIndex(at)
      return
    }
    const hits = await search(stop.address)
    const hit = hits.find((h) => h.id === stop.id) ?? hits[0]
    if (hit) selectParcel(hit)
    else toast({ title: "Couldn't find that house. Search the address.", variant: "destructive" })
  }

  const changePitch = (id: string | null) => {
    setPitchId(id)
    writePitch(id)
  }

  // ---------- Logging (no awaits before the optimistic state) ----------

  const logOutcome = (outcome: KnockOutcome) => {
    const parcel = selected
    if (!parcel) return
    const withQuote = outcome === "quote_given" || outcome === "booked"
    const input: LogKnockInput = {
      client_id: newClientId(),
      parcel_id: parcel.id,
      outcome,
      knocked_at: new Date().toISOString(),
      lat: geo.position?.lat ?? null,
      lng: geo.position?.lng ?? null,
      pitch_id: pitchId,
      quote_low: withQuote ? parcel.quote.low : null,
      quote_high: withQuote ? parcel.quote.high : null,
    }
    const entry: LogEntry = { client_id: input.client_id, parcel_id: parcel.id, address: parcel.address, outcome, status: "queued", knock_id: null }
    setLogs((prev) => [entry, ...prev].slice(0, 50))
    setParcels((prev) =>
      prev.map((p) =>
        p.id === parcel.id
          ? {
              ...p,
              lastKnock: { knocked_at: input.knocked_at, outcome, knocker_name: name },
              do_not_knock: p.do_not_knock || STOP_OUTCOMES.includes(outcome),
            }
          : p,
      ),
    )
    setDetails({
      client_id: input.client_id,
      outcome,
      quote: withQuote ? { low: parcel.quote.low, high: parcel.quote.high } : null,
      knock_id: null,
      status: "queued",
    })
    manualPick.current = false
    const items = enqueueKnock(input)
    setQueued(items.length)
    void flush()
  }

  const saveDetails = async (target: DetailsTarget, patch: KnockDetailsPatch) => {
    setSavingDetails(true)
    try {
      const entry = logsRef.current.find((l) => l.client_id === target.client_id)
      const knockId = entry?.knock_id ?? target.knock_id
      if (knockId) {
        let res: Awaited<ReturnType<typeof updateKnockDetailsAction>>
        try {
          res = await updateKnockDetailsAction(knockId, patch)
        } catch {
          // No signal: keep the sheet open with what was typed so Save can be tapped again.
          toast({ title: "Details didn't save. Check your signal and tap Save again.", variant: "destructive" })
          return
        }
        toast(res.ok ? { title: res.message, variant: "success" } : { title: res.error, variant: "destructive" })
      } else {
        // Not on the server yet: ride along with the queued knock, and re-send once it lands in case the flush beat us.
        patchQueuedKnock(target.client_id, patch)
        pendingDetails.current.set(target.client_id, patch)
        toast({ title: "Details will save with the knock.", variant: "success" })
      }
      if (entry && (patch.callback_window || patch.home_pattern)) {
        setParcels((prev) =>
          prev.map((p) =>
            p.id === entry.parcel_id
              ? { ...p, callback_window: patch.callback_window ?? p.callback_window, home_pattern: patch.home_pattern ?? p.home_pattern }
              : p,
          ),
        )
      }
      setDetails(null)
    } finally {
      setSavingDetails(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SessionBar
        pitches={pitches}
        pitchId={pitchId}
        onPitchChange={changePitch}
        season={season}
        plan={plan}
        doneParcelIds={doneParcelIds}
        onGoTo={(s) => void goTo(s)}
        queued={queued}
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Couldn&rsquo;t load houses</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{loadError}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                const p = geo.position
                void load(p?.lat ?? BASE.lat, p?.lng ?? BASE.lng, !!p)
              }}
            >
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <HousePicker
        parcels={parcels}
        index={index}
        onIndexChange={pickIndex}
        gpsStatus={geo.status}
        loading={loading}
        onRetryGps={geo.retry}
        onSearch={search}
        onPickSearch={selectParcel}
      />

      <OutcomeGrid onPick={logOutcome} disabled={!selected} doNotKnock={selected?.do_not_knock ?? false} />

      {logs.length ? (
        <section aria-label="This session" className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">This session: {logs.length} logged</p>
          <ul className="flex flex-col gap-1">
            {logs.slice(0, 5).map((l) => (
              <li key={l.client_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-ink">
                  <span className="font-semibold">{OUTCOME_LABEL[l.outcome]}</span> · {l.address}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold",
                    l.status === "sent" ? "text-brand-green-dark" : l.status === "failed" ? "text-destructive" : "text-amber-700",
                  )}
                >
                  {l.status === "sent" ? "Saved" : l.status === "failed" ? "Not saved" : "Queued"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DetailsSheet target={details} pitches={pitches} pitchId={pitchId} saving={savingDetails} onSave={saveDetails} onClose={() => setDetails(null)} />
    </div>
  )
}
