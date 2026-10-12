"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NumberStepper } from "@/components/ui/number-stepper"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { money } from "../format"
import { ItemsTable } from "../items-table"
import type { QuoteContext } from "../types"
import { useDecide } from "../use-action"

export function QuoteCard({ approval, context }: { approval: Approval; context: QuoteContext }) {
  const d = useDecide(approval.id)
  const { quote, customer, items } = context
  const payloadTotal = typeof approval.payload.price_total === "number" ? approval.payload.price_total : null
  const [editing, setEditing] = React.useState(false)
  const [total, setTotal] = React.useState<number>(quote?.price_total ?? payloadTotal ?? 0)
  const needsOwner = items.some((i) => i.status === "needs_owner")
  const href = quote ? `/admin/quotes/${quote.id}` : null

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel="Approve & send link"
          edit={{ kind: "toggle", onClick: () => setEditing(true), label: "Edit total" }}
          editing={editing}
          onCancelEdit={() => {
            setEditing(false)
            setTotal(quote?.price_total ?? payloadTotal ?? 0)
          }}
          onApproveEdited={() =>
            d.decide("edited", { payloadPatch: { price_total: total } }, { onSuccess: () => setEditing(false) })
          }
        >
          {href ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={href}>
                <ExternalLink aria-hidden="true" />
                Open quote
              </Link>
            </Button>
          ) : null}
        </DecisionButtons>
      }
    >
      {customer ? (
        <Facts
          items={[
            ["Customer", customer.name],
            ["Address", customer.address ?? "—"],
            ["Email", customer.email ?? "No email (link can't be sent)"],
          ]}
        />
      ) : null}
      <ItemsTable items={items} />
      {quote ? (
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-paper p-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Labor", quote.labor_total],
              ["Card fee", quote.fee_total],
              ["Profit", quote.profit_total],
              ["Price", quote.price_total],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wide text-ink-muted">{k}</dt>
              <dd className={k === "Price" ? "text-lg font-bold text-ink" : "font-semibold text-ink"}>{money(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {quote?.rationale ? <p className="whitespace-pre-line text-sm text-ink-muted">{quote.rationale}</p> : null}
      {needsOwner ? (
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950">
          A custom item still needs your price. Approving now sends only the priced items.
        </p>
      ) : null}
      {editing ? (
        <div className="max-w-xs space-y-1">
          <NumberStepper label="Quote total" prefix="$" step={5} min={1} value={total} onChange={setTotal} />
          <p className="text-xs text-ink-muted">
            Saved to the quote before the Stripe link is built. For line-by-line changes use{" "}
            {href ? (
              <Link className="underline" href={href}>
                the full quote
              </Link>
            ) : (
              "the full quote"
            )}
            .
          </p>
        </div>
      ) : null}
    </ApprovalShell>
  )
}
