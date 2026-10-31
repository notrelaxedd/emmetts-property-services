"use client"

import * as React from "react"
import { Banknote, CreditCard } from "lucide-react"
import { recordCashOrCheckPayment, sendQuote } from "@/app/admin/actions/quotes"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { money } from "@/components/admin/inbox/format"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NumberStepper } from "@/components/ui/number-stepper"

/**
 * Collect for a finished job from the front page's Money stage: record cash or check
 * (`recordCashOrCheckPayment`) or email the card link (`sendQuote`), the same actions as the quote
 * page's Payment card.
 */
export function CollectActions({
  quoteId,
  customerName,
  amount,
  email,
}: {
  quoteId: string
  customerName: string
  amount: number
  email: string | null
}) {
  const { pending, run } = useActionRunner()
  const [payAmount, setPayAmount] = React.useState(amount)
  const [checkNumber, setCheckNumber] = React.useState("")
  const checkId = React.useId()

  const offline = (method: "cash" | "check") => (
    <ConfirmDialog
      triggerVariant="outline"
      triggerClassName="h-11 sm:h-9"
      trigger={
        <>
          <Banknote aria-hidden="true" /> {method === "cash" ? "Cash" : "Check"}
        </>
      }
      disabled={pending}
      title={`Record ${method === "cash" ? "cash" : "a check"} from ${customerName}?`}
      description="Marks the quote and job paid (no card fee) and closes any card link or invoice they have."
      confirmLabel="Record payment"
      confirmDisabled={!(payAmount > 0)}
      onConfirm={async () => {
        const res = await run(() =>
          recordCashOrCheckPayment(quoteId, {
            method,
            amount: payAmount,
            check_number: method === "check" && checkNumber.trim() ? checkNumber.trim() : null,
          }),
        )
        return res.ok
      }}
    >
      <div className="grid gap-3">
        {method === "check" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={checkId}>Check number (optional)</Label>
            <Input id={checkId} maxLength={40} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </div>
        ) : null}
        <NumberStepper label="Amount received" prefix="$" min={0} step={5} value={payAmount} onChange={setPayAmount} />
        {payAmount > 0 && payAmount - amount >= 0.01 ? (
          <p className="text-xs text-ink-muted">The extra {money(payAmount - amount)} is a tip and counts as revenue.</p>
        ) : payAmount > 0 && amount - payAmount >= 0.01 ? (
          <p className="text-xs text-amber-900">The quote total is {money(amount)}. The difference is noted on the quote.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  )

  return (
    <div className="flex flex-wrap gap-2">
      {offline("cash")}
      {offline("check")}
      <ConfirmDialog
        triggerVariant="outline"
        triggerClassName="h-11 sm:h-9"
        trigger={
          <>
            <CreditCard aria-hidden="true" /> Email card link
          </>
        }
        disabled={pending || !email}
        title="Email a card payment link?"
        description={`Creates a Stripe Checkout link (test mode) for ${money(amount)} and emails it to ${email ?? "the customer"}, thanking them for the work.`}
        confirmLabel="Send"
        onConfirm={() => run(() => sendQuote(quoteId))}
      />
      {!email ? <span className="self-center text-xs text-ink-muted">No email on file for a card link.</span> : null}
    </div>
  )
}
