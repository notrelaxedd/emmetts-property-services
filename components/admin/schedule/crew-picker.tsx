"use client"

import * as React from "react"
import { crewForSlot } from "@/app/admin/actions/schedule"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { CrewChoice } from "@/lib/ops/crew-offers"

const WHY: Record<string, string> = {
  unavailable: "outside their hours",
  time_off: "time off",
  busy: "on another job",
  paused: "paused",
  removed: "removed",
}

/**
 * "Who should we email?" Opens when a job is dropped on the calendar (or from a job to ask more crew).
 * Nobody is ticked to start: only the names you tick get the "job available" email.
 */
export function CrewPicker({
  open,
  jobId,
  startISO,
  minutes,
  title,
  description,
  confirmLabel,
  allowNone = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  jobId: string | null
  startISO: string | null
  minutes: number
  title: string
  description: string
  confirmLabel: string
  /** Placing a job with nobody ticked is fine (no emails); asking more crew needs someone. */
  allowNone?: boolean
  onConfirm: (crewIds: string[]) => void
  onCancel: () => void
}) {
  const [crew, setCrew] = React.useState<CrewChoice[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [ticked, setTicked] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!open || !jobId || !startISO) return
    let live = true
    setCrew(null)
    setError(null)
    setTicked(new Set())
    void crewForSlot(jobId, startISO, Math.max(1, Math.round(minutes))).then((r) => {
      if (!live) return
      if (r.ok) setCrew(r.crew)
      else setError(r.reason)
    })
    return () => {
      live = false
    }
  }, [open, jobId, startISO, minutes])

  const toggle = (id: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!crew && !error ? <p className="text-sm text-ink-muted">Checking who&apos;s free…</p> : null}
        {crew && !crew.length ? <p className="text-sm text-ink-muted">No active crew yet.</p> : null}
        {crew?.length ? (
          <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
            {crew.map((c) => {
              const id = `pick-${c.id}`
              return (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox id={id} checked={ticked.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-sm">
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
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!allowNone && ticked.size === 0} onClick={() => onConfirm(Array.from(ticked))}>
            {ticked.size ? `${confirmLabel} · email ${ticked.size}` : allowNone ? `${confirmLabel} · no emails` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
