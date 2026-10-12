"use client"

import { RotateCcw } from "lucide-react"
import { retryApproval } from "@/app/admin/actions/approvals"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { Approval, ApprovalStatus } from "@/lib/db/types"
import { KindBadge } from "./approval-shell"
import { dateTime } from "./format"
import { useActionRunner } from "./use-action"

const FAILURE_PREFIX = "[side effect failed]"

const STATUS: Record<ApprovalStatus, { label: string; variant: "success" | "secondary" | "outline" | "warning" }> = {
  approved: { label: "Approved", variant: "success" },
  edited: { label: "Approved w/ edits", variant: "success" },
  rejected: { label: "Rejected", variant: "outline" },
  pending: { label: "Pending", variant: "warning" },
}

function RetryButton({ id }: { id: string }) {
  const { pending, run } = useActionRunner()
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => retryApproval(id), { success: "Retried successfully" })}>
      <RotateCcw aria-hidden="true" />
      {pending ? "Retrying…" : "Retry"}
    </Button>
  )
}

/** The last decided approvals, newest first, with a Retry button when a side effect failed. */
export function DecidedList({ approvals }: { approvals: Approval[] }) {
  if (!approvals.length) return <EmptyState title="Nothing decided yet" description="Approvals you decide show up here." />
  return (
    <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
      {approvals.map((a) => {
        const failed = !!a.decision_note?.includes(FAILURE_PREFIX) && a.status !== "rejected"
        const s = STATUS[a.status]
        return (
          <li key={a.id} className="flex flex-wrap items-start gap-3 p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <KindBadge kind={a.kind} />
                <Badge variant={failed ? "destructive" : s.variant}>{failed ? "Side effect failed" : s.label}</Badge>
                <span className="text-xs text-ink-muted">
                  {dateTime(a.decided_at)} · {a.decided_by ?? "—"}
                </span>
              </div>
              <p className="font-medium text-ink">{a.title}</p>
              {a.decision_note ? (
                <p className={failed ? "whitespace-pre-line text-sm text-destructive" : "whitespace-pre-line text-sm text-ink-muted"}>
                  {a.decision_note}
                </p>
              ) : null}
            </div>
            {failed ? <RetryButton id={a.id} /> : null}
          </li>
        )
      })}
    </ul>
  )
}
