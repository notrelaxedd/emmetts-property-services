"use client"

import { BellOff, CalendarCheck, CalendarClock, DoorClosed, FileText, ThumbsDown, type LucideIcon } from "lucide-react"
import type { KnockOutcome } from "@/lib/db/types"
import { cn } from "@/lib/utils"

type Def = { outcome: KnockOutcome; label: string; icon: LucideIcon; tone: "neutral" | "good" | "stop" }

/** Order matters: this is the grid (two columns, three rows). "Come back later" logs as call_back. */
export const WALK_OUTCOMES: readonly Def[] = [
  { outcome: "no_answer", label: "No answer", icon: DoorClosed, tone: "neutral" },
  { outcome: "not_interested", label: "Not interested", icon: ThumbsDown, tone: "neutral" },
  { outcome: "quote_given", label: "Quote given", icon: FileText, tone: "good" },
  { outcome: "booked", label: "Booked", icon: CalendarCheck, tone: "good" },
  { outcome: "call_back", label: "Come back later", icon: CalendarClock, tone: "neutral" },
  { outcome: "no_soliciting", label: "No Soliciting", icon: BellOff, tone: "stop" },
]

export const WALK_OUTCOME_LABEL: Partial<Record<KnockOutcome, string>> = Object.fromEntries(WALK_OUTCOMES.map((o) => [o.outcome, o.label]))

export type OutcomeButtonsProps = {
  onPick: (outcome: KnockOutcome) => void
  disabled?: boolean
}

/** Six big one-tap buttons (64 px tall) that fit a 360 px phone in two columns. */
export function OutcomeButtons({ onPick, disabled = false }: OutcomeButtonsProps) {
  return (
    <div role="group" aria-label="Outcome" className="grid grid-cols-2 gap-2">
      {WALK_OUTCOMES.map(({ outcome, label, icon: Icon, tone }) => (
        <button
          key={outcome}
          type="button"
          disabled={disabled}
          onClick={() => onPick(outcome)}
          className={cn(
            "flex min-h-16 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[0.9375rem] font-semibold leading-tight transition-colors active:scale-[0.98] disabled:opacity-40",
            tone === "good" && "border-brand-green-dark/40 bg-brand-green/25 text-ink hover:bg-brand-green/40",
            tone === "stop" && "border-destructive/40 bg-destructive/10 text-ink hover:bg-destructive/20",
            tone === "neutral" && "border-ink/15 bg-white text-ink hover:bg-ink/[0.04]",
          )}
        >
          <Icon className="size-5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
