"use client"

import * as React from "react"
import Link from "next/link"
import { Banknote, CalendarDays, Calculator, CreditCard, FileText, MapPin, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import {
  recordCashOrCheckPayment,
  reviseQuote,
  saveQuote,
  sendQuote,
  sendQuoteAsInvoice,
  setPaymentMethod,
  type SaveQuoteInput,
} from "@/app/admin/actions/quotes"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { money } from "@/components/admin/inbox/format"
import { ItemStatusBadge } from "@/components/admin/inbox/items-table"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { PropertyMap } from "@/components/admin/quotes/property-map"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { NumberStepper } from "@/components/ui/number-stepper"
import { Switch } from "@/components/ui/switch"
import type { JobStatus, MinutesRule, PaymentMethod, Quote, QuoteItem, QuoteItemStatus, TreeCover } from "@/lib/db/types"
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { estimateHours, fee, moneyRound, priceQuote, type PricingSettings, type QuoteTotals } from "@/lib/pricing"
import { cn } from "@/lib/utils"

export type EditorJob = { id: string; status: JobStatus; start_at: string | null; completed_at: string | null }
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })

export type EditorService = { id: string; name: string; minutes_rule: MinutesRule }
export type EditorProperty = {
  address: string | null
  lat: number | null
  lng: number | null
  lot_acres: number | null
  tree_cover: TreeCover | null
  parcel_id: string | null
}

type EditItem = {
  key: string
  id?: string
  service_id: string | null
  description: string
  is_custom: boolean
  crew_size: number
  est_hours: number
  price: number | null
  status: QuoteItemStatus
  partner_note: string | null
}

/** Mirrors the server's `nextStatus` so the live totals match what Save will store. */
function liveStatus(item: EditItem): QuoteItemStatus {
  if (!item.is_custom) return item.status === "priced" && item.price !== null && item.price > 0 ? "priced" : "auto"
  if (item.status === "referred" || item.status === "declined") return item.status
  return item.price !== null && item.price > 0 ? "priced" : "needs_owner"
}

/** Fixed-price line: custom, or a standard line the owner priced by hand (status `priced`). */
const isFixed = (item: EditItem) => item.is_custom || item.status === "priced"

let keySeq = 0
const newKey = () => `new-${++keySeq}`

function toEdit(i: QuoteItem): EditItem {
  return {
    key: i.id,
    id: i.id,
    service_id: i.service_id,
    description: i.description,
    is_custom: i.is_custom,
    crew_size: i.crew_size,
    est_hours: i.est_hours,
    price: i.price,
    status: i.status,
    partner_note: i.partner_note,
  }
}

const COVERS: TreeCover[] = ["none", "light", "medium", "heavy"]

export function QuoteEditor({
  quote,
  items: initialItems,
  property: initialProperty,
  settings,
  services,
  customerEmail,
  pendingCustomItemIds,
  invoiceDaysDefault = 7,
  taxEnabled = false,
  job = null,
}: {
  quote: Quote
  items: QuoteItem[]
  property: EditorProperty
  settings: PricingSettings
  services: EditorService[]
  customerEmail: string | null
  pendingCustomItemIds: string[]
  /** The job behind the quote (on the schedule's rail, on the calendar, or done). */
  job?: EditorJob | null
  /** `settings.invoice_days_until_due`: starting value of the "Send as invoice" stepper. */
  invoiceDaysDefault?: number
  /** STRIPE_TAX_ENABLED on the server: Stripe adds Ohio sales tax on top of the total. */
  taxEnabled?: boolean
}) {
  const { pending, run } = useActionRunner()
  const paid = !!quote.paid_at
  // Paid and declined quotes are locked; so is one with a pay link out ("Revise & re-send" expires the old
  // Checkout session and returns the quote to draft so edits can't silently change what they pay). A quote
  // confirmed by phone but not paid yet can still be edited: the price is settled when the job is done.
  const locked = paid || quote.status === "declined" || quote.status === "sent"

  const [items, setItems] = React.useState<EditItem[]>(() => initialItems.map(toEdit))
  const [wage, setWage] = React.useState(quote.wage || settings.default_wage)
  const [marginPct, setMarginPct] = React.useState(Math.round((quote.margin || settings.margin) * 100))
  const [property, setProperty] = React.useState<EditorProperty>(initialProperty)

  // A stored total that differs from the computed one is an owner override; keep showing it.
  const initialComputed = React.useMemo(
    () => safeTotals(initialItems.map(toEdit), settings, quote.wage || settings.default_wage, quote.margin || settings.margin),
    [initialItems, settings, quote.wage, quote.margin],
  )
  const [override, setOverride] = React.useState<number | null>(() =>
    initialComputed.totals && Math.abs(initialComputed.totals.price_total - quote.price_total) >= 0.01 ? quote.price_total : null,
  )

  const payload: SaveQuoteInput = {
    wage,
    margin: marginPct / 100,
    total_override: override,
    items: items.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      service_id: i.service_id,
      description: i.description,
      is_custom: i.is_custom,
      crew_size: i.crew_size,
      est_hours: i.est_hours,
      price: isFixed(i) ? i.price : null,
    })),
    property: { lot_acres: property.lot_acres, tree_cover: property.tree_cover, lat: property.lat, lng: property.lng },
  }
  const snapshot = JSON.stringify(payload)
  const [savedSnapshot] = React.useState(snapshot)
  const dirty = snapshot !== savedSnapshot

  const { totals, error: calcError } = safeTotals(items, settings, wage, marginPct / 100)
  const priceTotal = override ?? totals?.price_total ?? 0
  const feeTotal = priceTotal > 0 ? fee(priceTotal, settings) : 0
  const labor = totals?.labor_total ?? 0
  const profit = moneyRound(priceTotal - labor - feeTotal)
  const needsOwner = items.some((i) => liveStatus(i) === "needs_owner")
  const serviceById = new Map(services.map((s) => [s.id, s]))

  const update = (key: string, patch: Partial<EditItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const reestimate = () =>
    setItems((prev) =>
      prev.map((i) => {
        const rule = i.service_id ? serviceById.get(i.service_id)?.minutes_rule : undefined
        if (!rule || i.is_custom) return i
        try {
          return { ...i, est_hours: estimateHours(rule, property.lot_acres, property.tree_cover) }
        } catch {
          return i
        }
      }),
    )

  // A sent quote can be re-sent unchanged (customer lost the email); only paid / declined block sending.
  const sendBlocker = paid
    ? "Already paid."
    : quote.status === "declined"
      ? "Quote is declined."
      : dirty
      ? "Save your changes first."
      : needsOwner
        ? "Price, refer or decline the custom item first."
        : !customerEmail
          ? "Customer has no email address."
          : !(quote.price_total > 0)
            ? "Nothing is priced yet."
            : null

  const ids = { lat: React.useId(), lng: React.useId(), cover: React.useId() }
  const [invoiceDays, setInvoiceDays] = React.useState(invoiceDaysDefault)
  const hasInvoice = quote.status === "sent" && !!quote.stripe_invoice_url
  const plusTax = taxEnabled ? " plus sales tax" : ""

  // Cash / check: the customer paid in person. No email needed, and an expired quote can still be paid.
  const canPayOffline = !paid && quote.status !== "declined"
  const [method, setMethod] = React.useState<PaymentMethod>(quote.payment_method ?? "check")
  const jobDone = job?.status === "done"
  const scheduleHref = job ? `/admin/schedule?job=${job.id}` : "/admin/schedule"
  const offlineBlocker = dirty
    ? "Save your changes first."
    : needsOwner
      ? "Price, refer or decline the custom item first."
      : !(quote.price_total > 0)
        ? "Nothing is priced yet."
        : null
  const [payMethod, setPayMethod] = React.useState<"cash" | "check">("check")
  const [payAmount, setPayAmount] = React.useState(quote.price_total)
  const [checkNumber, setCheckNumber] = React.useState("")
  const payIds = { method: React.useId(), check: React.useId() }

  return (
    <div className="grid gap-4 2xl:grid-cols-[20rem_1fr]">
      {/* Property */}
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" aria-hidden="true" /> Property
          </CardTitle>
          <CardDescription>{property.address ?? "No address on file"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PropertyMap lat={property.lat} lng={property.lng} parcelId={property.parcel_id} />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.lat}>Lat</Label>
              <Input
                id={ids.lat}
                type="number"
                step="any"
                disabled={locked}
                value={property.lat ?? ""}
                onChange={(e) => setProperty({ ...property, lat: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.lng}>Lng</Label>
              <Input
                id={ids.lng}
                type="number"
                step="any"
                disabled={locked}
                value={property.lng ?? ""}
                onChange={(e) => setProperty({ ...property, lng: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
          </div>
          <NumberStepper
            label="Lot size"
            suffix="acres"
            step={0.05}
            min={0}
            disabled={locked}
            value={property.lot_acres ?? 0}
            onChange={(v) => setProperty({ ...property, lot_acres: v })}
          />
          {property.lot_acres === null ? <p className="text-xs text-ink-muted">Unknown: pricing assumed 0.25 acres.</p> : null}
          <div className="grid gap-1.5">
            <Label htmlFor={ids.cover}>Tree cover</Label>
            <NativeSelect
              id={ids.cover}
              disabled={locked}
              value={property.tree_cover ?? ""}
              onChange={(e) => setProperty({ ...property, tree_cover: (e.target.value || null) as TreeCover | null })}
            >
              <option value="">Unknown</option>
              {COVERS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={reestimate}>
            <Calculator aria-hidden="true" /> Re-estimate hours from lot
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* Line items */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Line items</CardTitle>
            {locked ? <Badge variant="secondary">Locked ({quote.status})</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length === 0 ? <p className="text-sm text-ink-muted">No line items.</p> : null}
            <ul className="space-y-3">
              {items.map((item, idx) => {
                const status = liveStatus(item)
                const resolved = status === "referred" || status === "declined"
                const computed = totals?.items[idx]?.price ?? 0
                return (
                  <li
                    key={item.key}
                    className={cn("rounded-md border border-ink/10 p-3", item.is_custom && "border-violet-200 bg-violet-50/40")}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={`Line ${idx + 1} description`}
                        className="min-w-[12rem] flex-1"
                        value={item.description}
                        maxLength={250}
                        disabled={locked}
                        onChange={(e) => update(item.key, { description: e.target.value })}
                      />
                      {item.is_custom ? <ItemStatusBadge status={status} /> : null}
                      {item.id && pendingCustomItemIds.includes(item.id) ? (
                        <Link href="/admin/inbox?filter=custom" className="text-xs underline">
                          Card in inbox
                        </Link>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={locked}
                        aria-label={`Remove ${item.description || `line ${idx + 1}`}`}
                        onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <NumberStepper
                        label="Crew"
                        min={1}
                        max={20}
                        step={1}
                        disabled={locked}
                        value={item.crew_size}
                        onChange={(v) => update(item.key, { crew_size: v })}
                      />
                      <NumberStepper
                        label="Hours"
                        suffix="h"
                        min={0}
                        step={0.25}
                        disabled={locked}
                        value={item.est_hours}
                        onChange={(v) => update(item.key, { est_hours: v })}
                      />
                      {isFixed(item) ? (
                        <NumberStepper
                          label={resolved ? `Price (${status})` : "Your price"}
                          prefix="$"
                          min={0}
                          step={5}
                          disabled={locked || resolved}
                          value={item.price ?? 0}
                          onChange={(v) => update(item.key, { price: v > 0 ? v : null })}
                        />
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium leading-none text-ink">Price</span>
                          <span className="flex h-11 items-center text-lg font-semibold tabular-nums text-ink">{money(computed)}</span>
                        </div>
                      )}
                    </div>
                    {item.partner_note ? <p className="mt-2 text-xs text-ink-muted">Partner note: {item.partner_note}</p> : null}
                  </li>
                )
              })}
            </ul>
            {!locked ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { key: newKey(), service_id: null, description: "", is_custom: false, crew_size: 1, est_hours: 1, price: null, status: "auto", partner_note: null },
                    ])
                  }
                >
                  <Plus aria-hidden="true" /> Add line (crew × hours)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { key: newKey(), service_id: null, description: "", is_custom: true, crew_size: 1, est_hours: 1, price: null, status: "needs_owner", partner_note: null },
                    ])
                  }
                >
                  <Plus aria-hidden="true" /> Add fixed-price line
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Pricing */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
            <CardDescription>
              price = max(minimum, labor ÷ (1 − margin)); fee = price × {(settings.card_fee_pct * 100).toFixed(1)}% +{" "}
              {money(settings.card_fee_fixed)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberStepper label="Wage" prefix="$" suffix="/h" min={0} step={0.5} disabled={locked} value={wage} onChange={setWage} />
              <NumberStepper label="Margin" suffix="%" min={0} max={95} step={5} disabled={locked} value={marginPct} onChange={setMarginPct} />
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-md bg-paper p-3 sm:grid-cols-4">
              {(
                [
                  ["Labor", labor],
                  ["Card fee", feeTotal],
                  ["Profit", profit],
                  ["Price", priceTotal],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">{k}</dt>
                  <dd
                    className={cn(
                      "tabular-nums",
                      k === "Price" ? "text-2xl font-bold text-ink" : "text-lg font-semibold text-ink",
                      k === "Profit" && v < 0 && "text-destructive",
                    )}
                  >
                    {money(v)}
                  </dd>
                </div>
              ))}
            </dl>
            {calcError ? <p className="text-sm text-destructive">{calcError}</p> : null}
            <p className="text-sm text-ink-muted">
              {settings.min_job_price !== null ? (
                <>
                  Minimum job price {money(settings.min_job_price)}.
                  {totals?.min_applied && override === null ? <span className="font-medium text-ink"> Applied to this quote.</span> : null}
                </>
              ) : (
                "No minimum job price set (TODO [MIN PRICE] in settings)."
              )}
              {needsOwner ? <span className="text-amber-900"> A custom item still needs your price.</span> : null}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={`override-${quote.id}`}
                  disabled={locked}
                  checked={override !== null}
                  onCheckedChange={(on) => setOverride(on ? Math.max(1, Math.round(totals?.price_total ?? quote.price_total)) : null)}
                />
                <Label htmlFor={`override-${quote.id}`}>Override total</Label>
              </div>
              {override !== null ? (
                <NumberStepper
                  className="w-56"
                  prefix="$"
                  min={1}
                  step={5}
                  disabled={locked}
                  value={override}
                  onChange={setOverride}
                  label="Total charged"
                />
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Payment: collected after the job */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="size-4" aria-hidden="true" /> Payment
            </CardTitle>
            <CardDescription>
              Collected once the job is done. The customer tells you cash, check or card when you confirm the day by phone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="rounded-md bg-paper px-3 py-2 text-sm text-ink">
              {paid ? (
                <>
                  <span className="font-semibold">Paid</span>
                  {quote.payment_method ? ` by ${PAYMENT_METHOD_LABEL[quote.payment_method].toLowerCase()}` : ""} on {dateFmt.format(new Date(quote.paid_at as string))}.
                </>
              ) : jobDone ? (
                <>
                  <span className="font-semibold">Job done{job?.completed_at ? ` ${dateFmt.format(new Date(job.completed_at))}` : ""}: collect {money(quote.price_total)}</span>
                  {quote.payment_method ? ` by ${PAYMENT_METHOD_LABEL[quote.payment_method].toLowerCase()}` : ""}. Record cash or check below, or email the card link.
                </>
              ) : quote.status === "accepted" ? (
                <>
                  <span className="font-semibold">Confirmed by phone.</span>
                  {job?.start_at ? ` Job on ${dateFmt.format(new Date(job.start_at))}.` : ""} Collect {money(quote.price_total)}
                  {quote.payment_method ? ` by ${PAYMENT_METHOD_LABEL[quote.payment_method].toLowerCase()}` : ""} when it&apos;s done.
                </>
              ) : quote.status === "sent" ? (
                <>
                  <span className="font-semibold">Pay link out.</span> The customer can pay by card any time until it expires.
                </>
              ) : (
                <>
                  <span className="font-semibold">Not confirmed yet.</span> Put the job on the calendar and call the customer; you&apos;ll record how they&apos;ll pay then.
                </>
              )}
            </p>

            {!paid && quote.status !== "declined" ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`method-${quote.id}`}>Customer will pay by</Label>
                  <NativeSelect id={`method-${quote.id}`} className="w-48" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={pending}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={pending || method === (quote.payment_method ?? null)} onClick={() => void run(() => setPaymentMethod(quote.id, method))}>
                  Save
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {canPayOffline ? (
                <ConfirmDialog
                  triggerVariant={jobDone && method !== "stripe" ? "cta-green" : "outline"}
                  trigger={
                    <>
                      <Banknote aria-hidden="true" /> Record cash / check
                    </>
                  }
                  disabled={pending || !!offlineBlocker}
                  title="Record a cash or check payment?"
                  description={
                    <>
                      Use this when the customer paid you in person. It marks the quote and job paid (no card fee) and closes any Stripe payment link or invoice they have.
                      {taxEnabled ? " Stripe doesn't collect sales tax on cash or check, so account for it yourself." : ""}
                    </>
                  }
                  confirmLabel="Record payment"
                  confirmDisabled={!(payAmount > 0)}
                  onConfirm={async () => {
                    const res = await run(() =>
                      recordCashOrCheckPayment(quote.id, {
                        method: payMethod,
                        amount: payAmount,
                        check_number: payMethod === "check" && checkNumber.trim() ? checkNumber.trim() : null,
                      }),
                    )
                    return res.ok
                  }}
                >
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor={payIds.method}>Paid by</Label>
                      <NativeSelect id={payIds.method} value={payMethod} onChange={(e) => setPayMethod(e.target.value as "cash" | "check")}>
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                      </NativeSelect>
                    </div>
                    {payMethod === "check" ? (
                      <div className="grid gap-1.5">
                        <Label htmlFor={payIds.check}>Check number (optional)</Label>
                        <Input id={payIds.check} maxLength={40} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
                      </div>
                    ) : null}
                    <NumberStepper label="Amount received" prefix="$" min={0} step={5} value={payAmount} onChange={setPayAmount} />
                    {payAmount > 0 && payAmount - quote.price_total >= 0.01 ? (
                      <p className="text-xs text-ink-muted">
                        The extra {money(payAmount - quote.price_total)} is a tip and counts as revenue.
                      </p>
                    ) : payAmount > 0 && quote.price_total - payAmount >= 0.01 ? (
                      <p className="text-xs text-amber-900">
                        The quote total is {money(quote.price_total)}. The difference is noted on the quote.
                      </p>
                    ) : null}
                  </div>
                </ConfirmDialog>
              ) : null}
              <ConfirmDialog
                triggerVariant={jobDone && method === "stripe" ? "cta-green" : "outline"}
                trigger={
                  <>
                    <CreditCard aria-hidden="true" /> {quote.sent_at && !paid ? "Re-send card link" : "Email card link"}
                  </>
                }
                disabled={pending || !!sendBlocker}
                title="Email a card payment link?"
                description={`Creates a Stripe Checkout link (test mode) for ${money(quote.price_total)}${plusTax} and emails it to ${customerEmail ?? "the customer"}.${quote.status === "accepted" ? " They confirmed by phone, so the email thanks them for the work and gives them the link." : ""}${hasInvoice ? " The open Stripe invoice is voided so only one can be paid." : ""}`}
                confirmLabel="Send"
                onConfirm={() => run(() => sendQuote(quote.id))}
              />
              <ConfirmDialog
                triggerVariant="ghost"
                trigger={
                  <>
                    <FileText aria-hidden="true" /> {hasInvoice ? "Re-send invoice" : "Send as invoice"}
                  </>
                }
                disabled={pending || !!sendBlocker}
                title={hasInvoice ? "Re-send the Stripe invoice?" : "Send a Stripe invoice?"}
                description={
                  <>
                    Stripe (test mode) emails {customerEmail ?? "the customer"} an invoice for {money(quote.price_total)}
                    {plusTax}, payable online by card or bank transfer. Good for commercial customers and net terms.
                    {quote.stripe_checkout_url ? " The open Checkout link is closed so only one can be paid." : ""}
                  </>
                }
                confirmLabel={hasInvoice ? "Re-send invoice" : "Send invoice"}
                confirmDisabled={!Number.isInteger(invoiceDays) || invoiceDays < 1 || invoiceDays > 365}
                onConfirm={async () => {
                  const res = await run(() => sendQuoteAsInvoice(quote.id, invoiceDays))
                  return res.ok
                }}
              >
                <NumberStepper
                  label="Due in"
                  suffix={invoiceDays === 1 ? "day" : "days"}
                  min={1}
                  max={365}
                  step={1}
                  value={invoiceDays}
                  onChange={(v) => setInvoiceDays(Math.round(v))}
                />
              </ConfirmDialog>
              {quote.status === "sent" ? (
                <ConfirmDialog
                  triggerVariant="outline"
                  trigger={
                    <>
                      <RotateCcw aria-hidden="true" /> Revise &amp; re-send
                    </>
                  }
                  disabled={pending}
                  title="Revise this quote?"
                  description="Expires the payment link (or voids the Stripe invoice) the customer has, and unlocks the quote for editing. Send it again when you're done."
                  confirmLabel="Unlock"
                  onConfirm={() => run(() => reviseQuote(quote.id))}
                />
              ) : null}
              {sendBlocker && !paid ? <span className="text-sm text-ink-muted">{sendBlocker}</span> : null}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={locked || pending || !dirty || !!calcError}
            onClick={() => void run(() => saveQuote(quote.id, payload))}
          >
            <Save aria-hidden="true" />
            {pending ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Button asChild variant={job && (job.status === "unscheduled" || job.status === "proposed" || job.status === "crew_confirmed") ? "cta-green" : "outline"}>
            <Link href={scheduleHref}>
              <CalendarDays aria-hidden="true" />
              {!job
                ? "Schedule"
                : job.status === "unscheduled"
                  ? "Put it on the calendar"
                  : job.status === "proposed" || job.status === "crew_confirmed"
                    ? "Call & confirm on the schedule"
                    : "Open on the schedule"}
            </Link>
          </Button>
          {!job && !needsOwner && !dirty && quote.status !== "declined" ? (
            <span className="text-sm text-ink-muted">The job appears on the schedule&apos;s rail once something here has a price.</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function safeTotals(
  items: EditItem[],
  settings: PricingSettings,
  wage: number,
  margin: number,
): { totals: QuoteTotals | null; error: string | null } {
  try {
    return {
      totals: priceQuote(
        items.map((i) => ({
          crew_size: i.crew_size,
          est_hours: i.est_hours,
          price: isFixed(i) ? i.price : null,
          is_custom: i.is_custom || liveStatus(i) === "priced",
          status: liveStatus(i),
        })),
        settings,
        { wage, margin },
      ),
      error: null,
    }
  } catch (e) {
    return { totals: null, error: e instanceof Error ? e.message : "Can't price these numbers." }
  }
}
