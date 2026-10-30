"use client"

import {
  Ban,
  BellOff,
  CalendarCheck,
  CheckCircle2,
  DoorClosed,
  FileText,
  PhoneCall,
  ThumbsDown,
  type LucideIcon,
} from "lucide-react"
import type { KnockOutcome } from "@/lib/db/types"
import { cn } from "@/lib/utils"

export type OutcomeDef = { outcome: KnockOutcome; label: string; hint?: string; icon: LucideIcon; tone: "neutral" | "good" | "stop" }

/** Order matters: this is the grid. */
export const OUTCOMES: readonly OutcomeDef[] = [
  { outcome: "no_answer", label: "No answer", hint: "hanger left", icon: DoorClosed, tone: "neutral" },
  { outcome: "not_interested", label: "Not interested", icon: ThumbsDown, tone: "neutral" },
  { outcome: "quote_given", label: "Quote given", icon: FileText, tone: "good" },
  { outcome: "booked", label: "Booked", icon: CalendarCheck, tone: "good" },
  { outcome: "call_back", label: "Call back", icon: PhoneCall, tone: "neutral" },
  { outcome: "no_soliciting", label: "No Soliciting sign", icon: BellOff, tone: "stop" },
  { outcome: "do_not_return", label: "Asked not to return", icon: Ban, tone: "stop" },
  { outcome: "has_service", label: "Already has service", icon: CheckCircle2, tone: "neutral" },
]

export const OUTCOME_LABEL: Record<KnockOutcome, string> = Object.fromEntries(OUTCOMES.map((o) => [o.outcome, o.label])) as Record<
  KnockOutcome,
  string
>

/** Still allowed on a do-not-knock house (they record why we must stay away). */
export const DO_NOT_KNOCK_ALLOWED: readonly KnockOutcome[] = ["no_soliciting", "do_not_return"]

export type OutcomeGridProps = {
  onPick: (outcome: KnockOutcome) => void
  /** No house selected or still loading: everything off. */
  disabled?: boolean
  /** The selected house is marked do not knock: only the "stay away" outcomes stay on. */
  doNotKnock?: boolean
}

/** Eight big one-tap buttons, two columns, 56 px tall. */
export function OutcomeGrid({ onPick, disabled = false, doNotKnock = false }: OutcomeGridProps) {
  return (
    <div role="group" aria-label="Outcome" className="grid grid-cols-2 gap-2">
      {OUTCOMES.map(({ outcome, label, hint, icon: Icon, tone }) => {
        const off = disabled || (doNotKnock && !DO_NOT_KNOCK_ALLOWED.includes(outcome))
        return (
          <button
            key={outcome}
            type="button"
            disabled={off}
            onClick={() => onPick(outcome)}
            className={cn(
              "flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-tight transition-colors active:scale-[0.98] disabled:opacity-40",
              tone === "good" && "border-brand-green-dark/40 bg-brand-green/25 text-ink hover:bg-brand-green/40",
              tone === "stop" && "border-destructive/40 bg-destructive/10 text-ink hover:bg-destructive/20",
              tone === "neutral" && "border-ink/15 bg-white text-ink hover:bg-ink/[0.04]",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex flex-col">
              <span>{label}</span>
              {hint ? <span className="text-xs font-normal text-ink-muted">{hint}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
