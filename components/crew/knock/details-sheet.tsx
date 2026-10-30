"use client"

import { Check, Loader2 } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { KnockDetailsPatch } from "@/lib/canvass/knock-queue"
import type { HomePattern, KnockOutcome, Pitch } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { OUTCOME_LABEL } from "./outcome-grid"

const CALLBACK_CHIPS = ["Weekdays after 5", "Weekends", "Mornings"] as const
const HOME_PATTERNS: { value: HomePattern; label: string }[] = [
  { value: "home_weekdays", label: "Home weekdays" },
  { value: "evenings_only", label: "Evenings only" },
  { value: "weekends_only", label: "Weekends only" },
  { value: "unknown", label: "Not sure" },
]

export type DetailsTarget = {
  client_id: string
  outcome: KnockOutcome
  /** Prefill for quote_given / booked. */
  quote: { low: number; high: number } | null
  /** Set once the server has it; details then go through updateKnockDetails. */
  knock_id: string | null
  /** "queued" until the server has it. */
  status: "queued" | "sent" | "failed"
}

export type DetailsSheetProps = {
  target: DetailsTarget | null
  pitches: Pick<Pitch, "id" | "name">[]
  pitchId: string | null
  saving: boolean
  onSave: (target: DetailsTarget, patch: KnockDetailsPatch) => Promise<void>
  onClose: () => void
}

const chip = (active: boolean) =>
  cn(
    "inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-medium transition-colors",
    active ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-ink/[0.04]",
  )

/** Pops up right after a tap: "Logged. Add details?" with the quick optional fields. */
export function DetailsSheet({ target, pitches, pitchId, saving, onSave, onClose }: DetailsSheetProps) {
  const [callback, setCallback] = React.useState("")
  const [pattern, setPattern] = React.useState<HomePattern | null>(null)
  const [pitch, setPitch] = React.useState<string>(pitchId ?? "")
  const [notes, setNotes] = React.useState("")
  const [low, setLow] = React.useState("")
  const [high, setHigh] = React.useState("")

  const key = target?.client_id ?? null
  React.useEffect(() => {
    setCallback("")
    setPattern(null)
    setPitch(pitchId ?? "")
    setNotes("")
    setLow(target?.quote ? String(target.quote.low) : "")
    setHigh(target?.quote ? String(target.quote.high) : "")
    // Reset for each new knock only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const withQuote = target?.outcome === "quote_given" || target?.outcome === "booked"
  const num = (s: string) => {
    const n = Number(s)
    return s.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, n)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target || saving) return
    const patch: KnockDetailsPatch = {
      callback_window: callback.trim() || null,
      home_pattern: pattern,
      pitch_id: pitch || null,
      notes: notes.trim() || null,
    }
    if (withQuote) {
      patch.quote_low = num(low)
      patch.quote_high = num(high) ?? num(low)
    }
    await onSave(target, patch)
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-paper px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <SheetHeader className="pr-14 text-left">
          <SheetTitle className="flex items-center gap-2 text-ink">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-green text-ink">
              <Check className="size-4" aria-hidden="true" />
            </span>
            Logged: {target ? OUTCOME_LABEL[target.outcome] : ""}
          </SheetTitle>
          <SheetDescription>
            {target?.status === "sent" ? "Saved." : "Saving in the background."} Add details? All optional.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={save} className="mt-4 flex flex-col gap-4" noValidate>
          {withQuote ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="kd-low">Quote low ($)</Label>
                <Input id="kd-low" type="number" inputMode="decimal" min={0} step={5} className="h-11 text-base" value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="kd-high">Quote high ($)</Label>
                <Input id="kd-high" type="number" inputMode="decimal" min={0} step={5} className="h-11 text-base" value={high} onChange={(e) => setHigh(e.target.value)} />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kd-callback">When are they home?</Label>
            <div className="flex flex-wrap gap-1.5">
              {CALLBACK_CHIPS.map((c) => (
                <button key={c} type="button" aria-pressed={callback === c} className={chip(callback === c)} onClick={() => setCallback(callback === c ? "" : c)}>
                  {c}
                </button>
              ))}
            </div>
            <Input id="kd-callback" placeholder="What they said, e.g. after 6 on Tuesdays" className="h-11 text-base" value={callback} onChange={(e) => setCallback(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Home pattern</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Home pattern">
              {HOME_PATTERNS.map((p) => (
                <button key={p.value} type="button" aria-pressed={pattern === p.value} className={chip(pattern === p.value)} onClick={() => setPattern(pattern === p.value ? null : p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {pitches.length ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kd-pitch">Pitch used</Label>
              <NativeSelect id="kd-pitch" className="h-11 text-base" value={pitch} onChange={(e) => setPitch(e.target.value)}>
                <option value="">No pitch</option>
                {pitches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kd-notes">Notes</Label>
            <Textarea id="kd-notes" rows={2} className="text-base" placeholder="Dog in yard, side door, ask for Pat" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12 text-base" onClick={onClose} disabled={saving}>
              Skip
            </Button>
            <Button type="submit" className="h-12 text-base" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Save details
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
