"use client"

import { Badge } from "@/components/ui/badge"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { calendarDate, label, slot } from "../format"
import type { CrewChangeContext, JobSummary } from "../types"
import { useDecide } from "../use-action"

export function JobList({ jobs, empty = "No jobs." }: { jobs: JobSummary[]; empty?: string }) {
  if (!jobs.length) return <p className="text-sm text-ink-muted">{empty}</p>
  return (
    <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
      {jobs.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium text-ink">{j.customer_name ?? "Customer"}</span>
            {j.address ? <span className="text-ink-muted"> · {j.address}</span> : null}
          </span>
          <span className="flex items-center gap-2 tabular-nums text-ink-muted">
            {slot(j.start_at, j.end_at)}
            <Badge variant={j.status === "booked" ? "success" : "secondary"}>{label(j.status)}</Badge>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CrewChangeCard({ approval, context }: { approval: Approval; context: CrewChangeContext }) {
  const d = useDecide(approval.id)
  const { exception: ex, crewName, jobsHit } = context
  const dates = ex ? (ex.date_from === ex.date_to ? calendarDate(ex.date_from) : `${calendarDate(ex.date_from)} – ${calendarDate(ex.date_to)}`) : "—"
  const times = ex?.start_time && ex?.end_time ? `${ex.start_time.slice(0, 5)}–${ex.end_time.slice(0, 5)}` : "All day"

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel={ex?.kind === "extra" ? "Approve extra day" : "Approve time off"}
          edit={{ kind: "link", href: "/admin/availability", label: "Open availability" }}
        />
      }
    >
      <Facts
        items={[
          ["Crew", crewName ?? "—"],
          ["Type", ex ? (ex.kind === "off" ? "Time off" : "Extra availability") : "—"],
          ["Dates", dates],
          ["Hours", times],
          ["Note", ex?.note || "—"],
        ]}
      />
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Jobs it hits ({jobsHit.length})</p>
        <JobList jobs={jobsHit} empty="No booked jobs in that window." />
      </div>
      <p className="text-xs text-ink-muted">Approving asks the scheduler to find cover for affected jobs. Rejecting declines the request.</p>
    </ApprovalShell>
  )
}
