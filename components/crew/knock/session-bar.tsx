"use client"

import { CloudOff, Footprints, Leaf } from "lucide-react"
import { NativeSelect } from "@/components/ui/native-select"
import type { PlanStopView } from "@/lib/canvass/views"
import type { Pitch } from "@/lib/db/types"

export const PITCH_KEY = "canvass.pitch"

export function readPitch(): string | null {
  try {
    return window.localStorage.getItem(PITCH_KEY)
  } catch {
    return null
  }
}

export function writePitch(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PITCH_KEY, id)
    else window.localStorage.removeItem(PITCH_KEY)
  } catch {
    // storage unavailable: the pick lasts for this screen only
  }
}

export type SessionBarProps = {
  pitches: Pick<Pitch, "id" | "name" | "script">[]
  pitchId: string | null
  onPitchChange: (id: string | null) => void
  season: { label: string; pitch: string } | null
  plan: { date: string; stops: PlanStopView[] } | null
  /** Parcels already logged this session are skipped in "next stops". */
  doneParcelIds: ReadonlySet<string>
  onGoTo: (stop: PlanStopView) => void
  queued: number
}

/** Pitch picker, season focus line, "N queued" chip and the next three plan stops. */
export function SessionBar({ pitches, pitchId, onPitchChange, season, plan, doneParcelIds, onGoTo, queued }: SessionBarProps) {
  const pitch = pitches.find((p) => p.id === pitchId) ?? null
  const nextStops = plan ? plan.stops.filter((s) => !doneParcelIds.has(s.id)).slice(0, 3) : []

  return (
    <section aria-label="Session" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="session-pitch" className="sr-only">
            Pitch
          </label>
          <NativeSelect id="session-pitch" className="h-11 text-base" value={pitchId ?? ""} onChange={(e) => onPitchChange(e.target.value || null)}>
            <option value="">Pick a pitch</option>
            {pitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {queued > 0 ? (
          <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-amber-200 px-3 text-xs font-semibold text-amber-950">
            <CloudOff className="size-3.5" aria-hidden="true" />
            {queued} queued
          </span>
        ) : null}
      </div>

      {season ? (
        <p className="flex items-start gap-1.5 text-sm text-ink">
          <Leaf className="mt-0.5 size-4 shrink-0 text-brand-green-dark" aria-hidden="true" />
          <span>
            <span className="font-semibold">{season.label}.</span> {pitch?.script?.trim() || season.pitch}
          </span>
        </p>
      ) : null}

      {nextStops.length ? (
        <div className="rounded-lg border border-ink/10 bg-white p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <Footprints className="size-3.5" aria-hidden="true" />
            Today&rsquo;s plan, next stops
          </p>
          <ol className="flex flex-col gap-1.5">
            {nextStops.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-ink">{s.order}. {s.address}</span>
                  <span className="block truncate text-xs text-ink-muted">{s.window.label}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onGoTo(s)}
                  className="h-9 shrink-0 rounded-md border border-ink/20 px-3 text-xs font-semibold text-ink hover:bg-ink/[0.04]"
                >
                  {i === 0 ? "Go to next" : "Go"}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
