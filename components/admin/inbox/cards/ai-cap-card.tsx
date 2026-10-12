"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { NumberStepper } from "@/components/ui/number-stepper"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { money } from "../format"
import type { AiCapContext } from "../types"
import { useDecide } from "../use-action"

export function AiCapCard({ approval, context }: { approval: Approval; context: AiCapContext }) {
  const d = useDecide(approval.id)
  const { spend, cap } = context
  const pct = cap && cap > 0 ? Math.min(100, Math.round((spend / cap) * 100)) : 100
  const [newCap, setNewCap] = React.useState<number>(() => Math.max(Math.ceil(((cap ?? spend) * 1.5) / 5) * 5, 10))

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons d={d} kind={approval.kind} approveLabel="Acknowledge" rejectLabel="Dismiss">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={d.pending || !(newCap > spend)}
            onClick={() => void d.decide("edited", { payloadPatch: { new_cap: newCap } }, { success: `AI cap raised to ${money(newCap)}` })}
          >
            Raise cap to {money(newCap)}
          </Button>
        </DecisionButtons>
      }
    >
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-ink-muted">AI spend this month</span>
          <span className="font-semibold tabular-nums text-ink">
            {money(spend)} <span className="font-normal text-ink-muted">of {cap === null ? "no cap" : money(cap)}</span>
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-amber-100" role="presentation">
          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-body">
          Drafting is paused until next month or until you raise the cap. Quotes and messages fall back to plain templates.
        </p>
      </div>
      <div className="max-w-xs">
        <NumberStepper label="Raise cap to" prefix="$" step={5} min={0} value={newCap} onChange={setNewCap} />
      </div>
    </ApprovalShell>
  )
}
