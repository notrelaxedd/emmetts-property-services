"use client"

import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { label, slot } from "../format"
import { RejectDialog } from "../reject-dialog"
import type { BookingContext } from "../types"
import { useDecide } from "../use-action"
import { formatDuration } from "@/lib/scheduler/time"

export function BookingCard({ approval, context }: { approval: Approval; context: BookingContext }) {
  const d = useDecide(approval.id)
  const { job, customer, crew, services, scheduleReason } = context
  const unschedulable = approval.payload.unschedulable === true
  const reason =
    (typeof approval.payload.reason === "string" && approval.payload.reason) || scheduleReason || approval.summary || null
  const scheduleHref = job ? `/admin/schedule?job=${job.id}` : "/admin/schedule"

  const details = (
    <Facts
      items={[
        ["Customer", customer?.name ?? job?.customer_name ?? "—"],
        ["Address", customer?.address ?? job?.address ?? "—"],
        ["When", job ? slot(job.start_at, job.end_at) : "—"],
        ["Duration", job ? formatDuration(job.est_minutes) : "—"],
        ["Services", services.length ? services.join(", ") : "—"],
        [
          "Crew",
          crew.length ? (
            <span key="crew" className="flex flex-wrap gap-1">
              {crew.map((c, i) => (
                <Badge key={i} variant={c.status === "accepted" ? "success" : "secondary"}>
                  {c.name} · {c.swapFrom ? `swap offered (from ${c.swapFrom})` : label(c.status)}
                </Badge>
              ))}
            </span>
          ) : (
            "No crew assigned"
          ),
        ],
      ]}
    />
  )

  if (unschedulable) {
    return (
      <ApprovalShell
        approval={approval}
        error={context.error}
        className="border-amber-300"
        actions={
          <>
            <Button asChild size="sm">
              <Link href={scheduleHref}>
                <CalendarDays aria-hidden="true" /> Open schedule
              </Link>
            </Button>
            <div className="ml-auto">
              <RejectDialog
                disabled={d.pending}
                label="Mark handled"
                variant="outline"
                title="Mark this as handled?"
                description="Use this once you've placed the job by hand (or decided not to). Nothing is sent."
                onReject={(note) => d.decide("rejected", { note: note || "Handled on the schedule" })}
              />
            </div>
          </>
        }
      >
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950">
          <span className="font-semibold">The scheduler couldn&apos;t place this job.</span> {reason ?? "No reason given."}
        </p>
        {details}
      </ApprovalShell>
    )
  }

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel="Book & confirm customer"
          edit={{ kind: "link", href: scheduleHref, label: "Change on schedule" }}
        />
      }
    >
      {details}
      {scheduleReason ? (
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">Why this slot:</span> {scheduleReason}
        </p>
      ) : null}
    </ApprovalShell>
  )
}
