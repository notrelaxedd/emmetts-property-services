"use client"

import * as React from "react"
import { Undo2 } from "lucide-react"
import { refundQuoteAction } from "@/app/admin/actions/quotes"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { money } from "@/components/admin/inbox/format"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** Full refund of a paid quote (cancels its job). Confirm dialog with a required reason. */
export function RefundButton({ quoteId, amount }: { quoteId: string; amount: number }) {
  const { pending, run } = useActionRunner()
  const [reason, setReason] = React.useState("")
  const id = React.useId()
  return (
    <ConfirmDialog
      trigger={
        <>
          <Undo2 aria-hidden="true" /> Refund
        </>
      }
      disabled={pending}
      title={`Refund ${money(amount)}?`}
      description="Refunds the full payment in Stripe, cancels the job and marks the quote declined. This can't be undone here."
      confirmLabel="Refund"
      confirmVariant="default"
      confirmDisabled={!reason.trim()}
      onConfirm={async () => {
        const res = await run(() => refundQuoteAction(quoteId, reason))
        return res.ok
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Reason</Label>
        <Textarea id={id} rows={3} maxLength={450} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer cancelled, moving out." />
      </div>
    </ConfirmDialog>
  )
}
