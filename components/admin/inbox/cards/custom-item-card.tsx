"use client"

import * as React from "react"
import Link from "next/link"
import { Ban, Forward, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NumberStepper } from "@/components/ui/number-stepper"
import { Textarea } from "@/components/ui/textarea"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { ConfirmDialog } from "../confirm-dialog"
import { hours, money } from "../format"
import { ItemsTable } from "../items-table"
import { PhotoGallery } from "../photo-gallery"
import { RejectDialog } from "../reject-dialog"
import type { CustomItemContext } from "../types"
import { useDecide } from "../use-action"

/** The plan's "Custom request card": the owner prices, refers or declines a custom line item. */
export function CustomItemCard({ approval, context }: { approval: Approval; context: CustomItemContext }) {
  const d = useDecide(approval.id)
  const { item, quote, customer, customRequest, photos, standardItems, standardTotal } = context
  const ai = item?.ai_summary ?? null

  const [price, setPrice] = React.useState<number>(item?.price ?? 0)
  const [estHours, setEstHours] = React.useState<number>(item?.est_hours || ai?.hours_min || 1)
  const [crew, setCrew] = React.useState<number>(item?.crew_size || ai?.crew_size || 1)
  const [partnerNote, setPartnerNote] = React.useState("")
  const noteId = React.useId()

  const description = item?.description ?? (typeof approval.payload.description === "string" ? approval.payload.description : null)

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <>
          <Button
            type="button"
            size="sm"
            disabled={d.pending || !(price > 0) || !(estHours > 0)}
            onClick={() =>
              void d.decide(
                "approved",
                { payloadPatch: { action: "price", price, est_hours: estHours, crew_size: crew } },
                { success: "Price added to the quote" },
              )
            }
          >
            <Plus aria-hidden="true" />
            {d.pending ? "Working…" : "Add my price to quote"}
          </Button>
          <ConfirmDialog
            trigger={
              <>
                <Forward aria-hidden="true" /> Refer to partner
              </>
            }
            disabled={d.pending}
            title="Refer to the partner tree service?"
            description="After you confirm, the customer gets an email saying a partner will handle this part. The rest of the quote is unaffected."
            confirmLabel="Refer"
            onConfirm={async () => {
              const res = await d.decide(
                "approved",
                { payloadPatch: { action: "refer", partner_note: partnerNote } },
                { success: "Referred to partner" },
              )
              return res.ok
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={noteId}>Note for the partner / customer email</Label>
              <Textarea
                id={noteId}
                rows={4}
                maxLength={2000}
                value={partnerNote}
                onChange={(e) => setPartnerNote(e.target.value)}
                placeholder="e.g. Large oak over the garage, needs a bucket truck."
              />
            </div>
          </ConfirmDialog>
          <ConfirmDialog
            trigger={
              <>
                <Ban aria-hidden="true" /> Decline
              </>
            }
            disabled={d.pending}
            title="Decline this custom request?"
            description="After you confirm, the customer gets a polite email saying we can't take this part on."
            confirmLabel="Decline request"
            onConfirm={async () => {
              const res = await d.decide("approved", { payloadPatch: { action: "decline" } }, { success: "Declined" })
              return res.ok
            }}
          />
          <div className="ml-auto">
            <RejectDialog
              disabled={d.pending}
              label="Dismiss"
              title="Dismiss this card?"
              description="Nothing is sent and the item stays unpriced on the quote."
              variant="ghost"
              onReject={(note) => d.decide("rejected", { note })}
            />
          </div>
        </>
      }
    >
      <Facts
        items={[
          ["Customer", customer?.name ?? "—"],
          ["Address", customer?.address ?? "—"],
          ["Request", description ?? "—"],
        ]}
      />

      <section aria-label="Customer note" className="rounded-md border border-ink/10 bg-paper p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Customer note</p>
        <p className="mt-1 whitespace-pre-line text-sm text-ink">{customRequest || "No note."}</p>
      </section>

      <section aria-label="Photos" className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Photos</p>
        <PhotoGallery photos={photos} />
      </section>

      <section aria-label="Standard part of the quote" className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Auto-quoted standard part</p>
          {quote ? (
            <Link href={`/admin/quotes/${quote.id}`} className="text-xs underline">
              Open quote
            </Link>
          ) : null}
        </div>
        {standardItems.length ? (
          <>
            <ItemsTable items={standardItems} />
            <p className="text-right text-sm">
              Standard items: <span className="font-semibold text-ink">{money(standardTotal)}</span>
              {quote ? <span className="text-ink-muted"> · quote total now {money(quote.price_total)}</span> : null}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">Only the custom request on this quote.</p>
        )}
      </section>

      {ai ? (
        <section aria-label="Claude's read" className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-900">
            <Sparkles className="size-3.5" aria-hidden="true" /> Claude&apos;s read
          </p>
          <p className="mt-1 text-ink">{ai.summary}</p>
          <Facts
            className="mt-2"
            items={[
              ["Crew size", ai.crew_size],
              ["Hours", `${hours(ai.hours_min)} – ${hours(ai.hours_max)}`],
              [
                "Suggested price",
                <span key="p">
                  {money(ai.price_min)} – {money(ai.price_max)}{" "}
                  <span className="text-xs text-violet-900">(suggestion, never sent)</span>
                </span>,
              ],
            ]}
          />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">No AI summary yet (the quotes worker adds one when it can).</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <NumberStepper label="Your price" prefix="$" step={25} min={0} value={price} onChange={setPrice} />
        <NumberStepper label="Hours on site" suffix="h" step={0.25} min={0} value={estHours} onChange={setEstHours} />
        <NumberStepper label="Crew needed" step={1} min={1} max={20} value={crew} onChange={setCrew} />
      </div>
    </ApprovalShell>
  )
}
