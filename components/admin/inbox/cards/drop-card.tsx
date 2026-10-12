"use client"

import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { slot } from "../format"
import type { DropContext } from "../types"
import { useDecide } from "../use-action"

function until(h: number | null): string {
  if (h === null) return "—"
  if (h < 0) return "Already started"
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} days`
}

export function DropCard({ approval, context }: { approval: Approval; context: DropContext }) {
  const d = useDecide(approval.id)
  const { crewName, job, hoursUntilStart } = context
  const urgent = hoursUntilStart !== null && hoursUntilStart < 24
  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel="Approve drop & find cover"
          rejectLabel="Keep them on it"
          edit={{ kind: "link", href: job ? `/admin/schedule?job=${job.id}` : "/admin/schedule", label: "Open schedule" }}
        />
      }
    >
      <Facts
        items={[
          ["Crew", crewName ?? "—"],
          ["Job", job ? `${job.customer_name ?? "Customer"}${job.address ? ` · ${job.address}` : ""}` : "—"],
          ["Starts", job ? slot(job.start_at, job.end_at) : "—"],
          [
            "Time until start",
            <span key="u" className={urgent ? "font-semibold text-destructive" : undefined}>
              {until(hoursUntilStart)}
            </span>,
          ],
        ]}
      />
    </ApprovalShell>
  )
}
