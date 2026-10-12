"use client"

import type * as React from "react"
import Link from "next/link"
import { Check, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RejectDialog } from "./reject-dialog"
import { REJECT_EFFECTS } from "./types"
import type { Decider } from "./use-action"
import type { ApprovalKind } from "@/lib/db/types"

export type EditControl =
  | { kind: "toggle"; onClick: () => void; label?: string }
  | { kind: "link"; href: string; label?: string }

/**
 * Approve / Edit / Reject. While `editing`, the bar becomes "Approve with edits" + Cancel and
 * `onApproveEdited` supplies the payload patch.
 */
export function DecisionButtons({
  d,
  kind,
  approveLabel = "Approve",
  onApprove,
  edit,
  editing,
  onApproveEdited,
  onCancelEdit,
  hideApprove,
  approveDisabled,
  rejectLabel,
  children,
}: {
  d: Decider
  /** Used for the reject dialog's "what happens" line. */
  kind?: ApprovalKind
  approveLabel?: string
  /** Default: approve with no patch. Return null to abort (e.g. invalid input). */
  onApprove?: () => Promise<unknown> | void
  edit?: EditControl
  editing?: boolean
  onApproveEdited?: () => Promise<unknown> | void
  onCancelEdit?: () => void
  hideApprove?: boolean
  approveDisabled?: boolean
  rejectLabel?: string
  /** Extra buttons placed before Reject. */
  children?: React.ReactNode
}) {
  if (editing) {
    return (
      <>
        <Button type="button" size="sm" disabled={d.pending} onClick={() => void onApproveEdited?.()}>
          <Check aria-hidden="true" />
          {d.pending ? "Saving…" : "Approve with edits"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={d.pending} onClick={onCancelEdit}>
          Cancel
        </Button>
      </>
    )
  }
  return (
    <>
      {hideApprove ? null : (
        <Button
          type="button"
          size="sm"
          disabled={d.pending || approveDisabled}
          onClick={() => void (onApprove ? onApprove() : d.decide("approved"))}
        >
          <Check aria-hidden="true" />
          {d.pending ? "Working…" : approveLabel}
        </Button>
      )}
      {edit?.kind === "toggle" ? (
        <Button type="button" size="sm" variant="outline" disabled={d.pending} onClick={edit.onClick}>
          <Pencil aria-hidden="true" />
          {edit.label ?? "Edit"}
        </Button>
      ) : null}
      {edit?.kind === "link" ? (
        <Button asChild size="sm" variant="outline">
          <Link href={edit.href}>
            <Pencil aria-hidden="true" />
            {edit.label ?? "Edit"}
          </Link>
        </Button>
      ) : null}
      {children}
      <div className="ml-auto">
        <RejectDialog
          disabled={d.pending}
          label={rejectLabel}
          description={kind ? `${REJECT_EFFECTS[kind]} Add a note if you want to remember why.` : undefined}
          onReject={(note) => d.decide("rejected", { note })} />
      </div>
    </>
  )
}
