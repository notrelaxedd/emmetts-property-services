"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { slot } from "../format"
import type { WeatherHoldContext } from "../types"
import { useDecide } from "../use-action"

export function WeatherHoldCard({ approval, context }: { approval: Approval; context: WeatherHoldContext }) {
  const d = useDecide(approval.id)
  const { jobs } = context
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(jobs.map((j) => j.id)))
  const changed = selected.size !== jobs.length
  const forecast = typeof approval.payload.forecast === "string" ? approval.payload.forecast : null

  const approve = () =>
    changed
      ? d.decide("edited", { payloadPatch: { job_ids: Array.from(selected) } })
      : d.decide("approved")

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel={changed ? `Hold ${selected.size} selected` : `Hold ${jobs.length === 1 ? "this job" : `all ${jobs.length} jobs`}`}
          onApprove={approve}
          approveDisabled={selected.size === 0}
        />
      }
    >
      {forecast ? <p className="text-sm text-ink">{forecast}</p> : null}
      {jobs.length ? (
        <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
          {jobs.map((j) => {
            const id = `hold-${approval.id}-${j.id}`
            return (
              <li key={j.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox
                  id={id}
                  checked={selected.has(j.id)}
                  onCheckedChange={(v) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (v === true) next.add(j.id)
                      else next.delete(j.id)
                      return next
                    })
                  }
                />
                <label htmlFor={id} className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-3">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{j.customer_name ?? "Customer"}</span>
                    {j.address ? <span className="text-ink-muted"> · {j.address}</span> : null}
                  </span>
                  <span className="tabular-nums text-ink-muted">{slot(j.start_at, j.end_at)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No jobs listed on this hold.</p>
      )}
      <p className="text-xs text-ink-muted">Held jobs come off the schedule and the scheduler re-plans them.</p>
    </ApprovalShell>
  )
}
