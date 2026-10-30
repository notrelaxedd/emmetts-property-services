"use client"

import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { deleteQuoteAction } from "@/app/admin/actions/quotes"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { money } from "@/components/admin/inbox/format"
import { useActionRunner } from "@/components/admin/inbox/use-action"

/**
 * Delete a quote with its lines, job and lead (and its money on the Money page). `compact` is the
 * icon-only version for table rows; `redirectTo` is where to go once it's gone (the quote page itself).
 */
export function DeleteQuoteButton({
  quoteId,
  customerName,
  amount,
  paid,
  compact,
  redirectTo,
}: {
  quoteId: string
  customerName: string
  amount: number
  paid: boolean
  compact?: boolean
  redirectTo?: string
}) {
  const router = useRouter()
  const { pending, run } = useActionRunner()
  return (
    <ConfirmDialog
      trigger={
        compact ? (
          <>
            <Trash2 aria-hidden="true" />
            <span className="sr-only">Delete quote</span>
          </>
        ) : (
          <>
            <Trash2 aria-hidden="true" /> Delete
          </>
        )
      }
      triggerVariant={compact ? "ghost" : "outline"}
      disabled={pending}
      title={`Delete ${customerName}'s ${money(amount)} quote?`}
      description={
        <>
          Its lines, job and lead are deleted too{paid ? ", and its money comes off the Money page" : ""}. An open pay link or invoice is
          closed. {paid ? "A card payment isn't refunded (use Refund for that). " : ""}This can&rsquo;t be undone.
        </>
      }
      confirmLabel="Delete quote"
      onConfirm={async () => {
        const res = await run(() => deleteQuoteAction(quoteId))
        if (res.ok && redirectTo) router.push(redirectTo)
        return res.ok
      }}
    />
  )
}
