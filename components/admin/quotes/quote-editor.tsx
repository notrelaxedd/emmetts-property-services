"use client"

import * as React from "react"
import Link from "next/link"
import { Banknote, CalendarDays, Calculator, ChevronDown, CreditCard, Crown, FileText, MapPin, Plus, Receipt, RotateCcw, Save, Sprout, Trash2, X } from "lucide-react"
import {
  recordCashOrCheckPayment,
  reviseQuote,
  saveQuote,
  sendQuote,
  sendQuoteAsInvoice,
  setPaymentMethod,
  type SaveQuoteInput,
} from "@/app/admin/actions/quotes"
import { setOwnersWorking } from "@/app/admin/actions/schedule"
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
import { estimateHours, fee, moneyRound, priceQuote, sumCosts, type PricingSettings, type QuoteTotals } from "@/lib/pricing"
import { costPresetsFor, isAerationLine } from "@/lib/quote-costs"
import { cn } from "@/lib/utils"

export type EditorJob = { id: string; status: JobStatus; start_at: string | null; completed_at: string | null; owners_working?: boolean | null }
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })

export type EditorService = { id: string; name: string; minutes_rule: MinutesRule; slug?: string; default_crew_size?: number; active?: boolean }
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
  /** Out-of-pocket costs: rentals, seed, dump fees. */
  costs: EditCost[]
}

type EditCost = { key: string; label: string; amount: number }

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
    costs: (Array.isArray(i.costs) ? i.costs : []).map((c) => ({ key: newKey(), label: String(c?.label ?? ""), amount: Number(c?.amount) || 0 })),
  }
}

/** Costs as saved: blank rows dropped, a nameless amount called "Cost". */
function cleanCosts(costs: EditCost[]): { label: string; amount: number }[] {
  return costs
    .filter((c) => c.label.trim() || c.amount > 0)
    .map((c) => ({ label: c.label.trim().slice(0, 80) || "Cost", amount: Math.max(0, c.amount) }))
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
      costs: cleanCosts(i.costs),
    })),
    property: { lot_acres: property.lot_acres, tree_cover: property.tree_cover, lat: property.lat, lng: property.lng },
  }
  const snapshot = JSON.stringify(payload)
  const [savedSnapshot] = React.useState(snapshot)
  const dirty = snapshot !== savedSnapshot

  const { totals, error: calcError } = safeTotals(items, settings, wage, marginPct / 100)
  const priceTotal = override ?? totals?.price_total ?? 0
  const ownersWorking = !!job?.owners_working
  const labor = totals?.labor_total ?? 0
  const crewPay = ownersWorking ? 0 : labor
  const lineHours = items.reduce((h, i) => (liveStatus(i) === "referred" || liveStatus(i) === "declined" ? h : h + (Number(i.est_hours) || 0)), 0)
  const needsOwner = items.some((i) => liveStatus(i) === "needs_owner")
  const serviceById = new Map(services.map((s) => [s.id, s]))

  const update = (key: string, patch: Partial<EditItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const updateCosts = (key: string, fn: (costs: EditCost[]) => EditCost[]) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, costs: fn(i.costs) } : i)))
  const addCost = (key: string, label: string) => updateCosts(key, (c) => [...c, { key: newKey(), label, amount: 0 }])

  /** A line for one of the catalogue's services, hours estimated from the lot like the quote worker does. */
  const lineFor = (svc: EditorService): EditItem => {
    let est_hours = 1
    try {
      est_hours = estimateHours(svc.minutes_rule, property.lot_acres, property.tree_cover)
    } catch {
      /* keep 1 h */
    }
    return {
      key: newKey(),
      service_id: svc.id,
      description: svc.name,
      is_custom: false,
      crew_size: Math.max(1, svc.default_crew_size ?? 1),
      est_hours,
      price: null,
      status: "auto",
      partner_note: null,
      costs: costPresetsFor(svc.slug, svc.name).length ? [{ key: newKey(), label: costPresetsFor(svc.slug, svc.name)[0], amount: 0 }] : [],
    }
  }
  const addService = (id: string) => {
    const svc = serviceById.get(id)
    if (svc) setItems((prev) => [...prev, lineFor(svc)])
  }
  const overseeding = services.find((s) => s.slug === "overseeding")
  const hasOverseeding = items.some((i) => (overseeding && i.service_id === overseeding.id) || /seed/i.test(i.description))

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
  // The card fee only exists when the customer pays by card.
  const byCard = paid ? quote.payment_method === "stripe" : method === "stripe"
  const feeTotal = byCard && priceTotal > 0 ? fee(priceTotal, settings) : 0
  const costTotal = totals?.cost_total ?? 0
  const profit = moneyRound(priceTotal - crewPay - costTotal - feeTotal)
  const perHour = lineHours > 0 ? profit / lineHours : null
  const setOwners = (on: boolean) =>
    job &&
    void run(async () => {
      const r = await setOwnersWorking(job.id, on)
      return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.reason }
    })


  const tile = "rounded-md px-3 py-2"
  return (
    <div className="space-y-3">
      {/* The deal at a glance: stays on screen while you edit */}
      <div className="sticky top-0 z-20 -mx-1 rounded-lg border border-ink/10 bg-white/95 p-2 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-stretch gap-1.5">
          <div className={cn(tile, "bg-ink text-white")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Price</p>
            <p className="text-2xl font-bold leading-tight tabular-nums">{money(priceTotal)}</p>
          </div>
          <div className={cn(tile, "bg-paper")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Crew pay</p>
            <p className="text-lg font-bold leading-tight tabular-nums text-ink">{ownersWorking ? "$0" : money(labor)}</p>
            <p className="text-[11px] text-ink-muted">{ownersWorking ? "owners doing it" : `${money(wage)}/h`}</p>
          </div>
          {costTotal > 0 ? (
            <div className={cn(tile, "bg-paper")}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Costs</p>
              <p className="text-lg font-bold leading-tight tabular-nums text-ink">{money(costTotal)}</p>
              <p className="text-[11px] text-ink-muted">rentals, materials, fees</p>
            </div>
          ) : null}
          {feeTotal > 0 ? (
            <div className={cn(tile, "bg-paper")}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Card fee</p>
              <p className="text-lg font-bold leading-tight tabular-nums text-ink">{money(feeTotal)}</p>
              <p className="text-[11px] text-ink-muted">pays by card</p>
            </div>
          ) : null}
          <div className={cn(tile, profit < 0 ? "bg-red-50" : "bg-brand-green/15")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Take-home</p>
            <p className={cn("text-2xl font-bold leading-tight tabular-nums", profit < 0 ? "text-destructive" : "text-brand-green-dark")}>{money(profit)}</p>
            <p className="text-[11px] text-ink-muted">{priceTotal > 0 ? `${Math.round((profit / priceTotal) * 100)}% of price` : "—"}</p>
          </div>
          <div className={cn(tile, "bg-paper")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Time on site</p>
            <p className="text-lg font-bold leading-tight tabular-nums text-ink">{lineHours ? `${Math.round(lineHours * 100) / 100}h` : "—"}</p>
            <p className="text-[11px] text-ink-muted">{perHour !== null ? `${money(Math.round(perHour))}/h take-home` : ""}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 px-1">
            {locked ? <Badge variant="secondary">Locked ({quote.status})</Badge> : null}
            <Button type="button" disabled={locked || pending || !dirty || !!calcError} onClick={() => void run(() => saveQuote(quote.id, payload))}>
              <Save aria-hidden="true" />
              {pending ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Button asChild variant={job && (job.status === "unscheduled" || job.status === "proposed" || job.status === "crew_confirmed") ? "cta-green" : "outline"}>
              <Link href={scheduleHref}>
                <CalendarDays aria-hidden="true" />
                {!job
                  ? "Schedule"
                  : job.status === "unscheduled"
                    ? "Put on calendar"
                    : job.status === "proposed" || job.status === "crew_confirmed"
                      ? "Call & confirm"
                      : "Open on calendar"}
              </Link>
            </Button>
          </div>
        </div>
        {calcError ? <p className="px-1 pt-1 text-sm text-destructive">{calcError}</p> : null}
        {needsOwner ? <p className="px-1 pt-1 text-sm text-amber-900">A custom line still needs your price.</p> : null}
      </div>

      {/* Lines: one row each, everything editable in place */}
      <Card>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_5rem_5.5rem_6.5rem_2.25rem] gap-2 border-b border-ink/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted md:grid">
            <span>Service</span>
            <span>Crew</span>
            <span>Hours</span>
            <span className="text-right">Crew pay</span>
            <span className="text-right">Price</span>
            <span />
          </div>
          {items.length === 0 ? <p className="px-3 py-4 text-sm text-ink-muted">No line items yet.</p> : null}
          <ul className="divide-y divide-ink/10">
            {items.map((item, idx) => {
              const status = liveStatus(item)
              const resolved = status === "referred" || status === "declined"
              const computed = totals?.items[idx]?.price ?? 0
              const lineLabor = totals?.items[idx]?.labor ?? 0
              return (
                <li key={item.key} className={cn("px-3 py-2", item.is_custom && "bg-violet-50/50")}>
                  <div className="grid grid-cols-[4.5rem_5rem_minmax(0,1fr)_6.5rem_2.25rem] items-center gap-2 md:grid-cols-[minmax(0,1fr)_4.5rem_5rem_5.5rem_6.5rem_2.25rem]">
                    <div className="col-span-5 flex min-w-0 items-center gap-1.5 md:col-span-1">
                      <Input
                        aria-label={`Line ${idx + 1} description`}
                        className="h-9 min-w-0 flex-1"
                        value={item.description}
                        maxLength={250}
                        disabled={locked}
                        placeholder="What's the job?"
                        onChange={(e) => update(item.key, { description: e.target.value })}
                      />
                      {item.is_custom ? <ItemStatusBadge status={status} /> : null}
                    </div>
                    <Input
                      aria-label={`Line ${idx + 1} crew`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      className="h-9 tabular-nums"
                      disabled={locked}
                      value={item.crew_size}
                      onChange={(e) => update(item.key, { crew_size: Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))) })}
                    />
                    <Input
                      aria-label={`Line ${idx + 1} hours`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.25}
                      className="h-9 tabular-nums"
                      disabled={locked}
                      value={item.est_hours}
                      onChange={(e) => update(item.key, { est_hours: Math.max(0, Number(e.target.value) || 0) })}
                    />
                    <span className={cn("text-right text-sm tabular-nums text-ink-muted", ownersWorking && "line-through")}>{money(lineLabor)}</span>
                    {isFixed(item) ? (
                      <Input
                        aria-label={`Line ${idx + 1} price`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={5}
                        className="h-9 text-right font-semibold tabular-nums"
                        disabled={locked || resolved}
                        placeholder="$"
                        value={item.price ?? ""}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          update(item.key, { price: e.target.value === "" || !(v > 0) ? null : v })
                        }}
                      />
                    ) : (
                      <span className="text-right text-sm font-semibold tabular-nums text-ink">{money(computed)}</span>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9"
                      disabled={locked}
                      aria-label={`Remove ${item.description || `line ${idx + 1}`}`}
                      onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {item.partner_note || (item.id && pendingCustomItemIds.includes(item.id)) ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      {item.partner_note ? `Partner note: ${item.partner_note} ` : ""}
                      {item.id && pendingCustomItemIds.includes(item.id) ? (
                        <Link href="/admin/inbox?filter=custom" className="underline">
                          Card in inbox
                        </Link>
                      ) : null}
                    </p>
                  ) : null}
                  {!resolved ? (
                    <LineCosts
                      item={item}
                      slug={item.service_id ? serviceById.get(item.service_id)?.slug : undefined}
                      fixedPrice={isFixed(item)}
                      locked={locked}
                      onChange={(fn) => updateCosts(item.key, fn)}
                      onAdd={(label) => addCost(item.key, label)}
                      onAddOverseeding={
                        overseeding && !hasOverseeding && isAerationLine(item.service_id ? serviceById.get(item.service_id)?.slug : undefined, item.description)
                          ? () => setItems((prev) => {
                              const at = prev.findIndex((p) => p.key === item.key)
                              const next = [...prev]
                              next.splice(at + 1, 0, lineFor(overseeding))
                              return next
                            })
                          : undefined
                      }
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 bg-paper/60 px-3 py-2">
            {!locked ? (
              <div className="flex flex-wrap gap-1.5">
                <NativeSelect
                  aria-label="Add a service line (priced by hours)"
                  className="h-8 w-56 text-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addService(e.target.value)
                  }}
                >
                  <option value="">+ Service (priced by hours)…</option>
                  {services
                    .filter((svc) => svc.active !== false)
                    .map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                </NativeSelect>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { key: newKey(), service_id: null, description: "", is_custom: true, crew_size: 1, est_hours: 1, price: null, status: "needs_owner", partner_note: null, costs: [] },
                    ])
                  }
                >
                  <Plus aria-hidden="true" /> Line (your price)
                </Button>
              </div>
            ) : (
              <span />
            )}
            <p className="text-sm tabular-nums text-ink-muted">
              {totals?.min_applied && override === null && settings.min_job_price !== null ? <span className="mr-2 text-ink">Minimum {money(settings.min_job_price)} applied ·</span> : null}
              Lines total <span className="font-semibold text-ink">{money(totals?.price_total ?? 0)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* How the price is worked out: wage, margin, or just type the total */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-x-5 gap-y-3 p-3">
          <div className="grid gap-1">
            <Label htmlFor={`wage-${quote.id}`} className="text-xs">Crew wage</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-ink-muted">$</span>
              <Input
                id={`wage-${quote.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                className="h-9 w-20 tabular-nums"
                disabled={locked}
                value={wage}
                onChange={(e) => setWage(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="text-sm text-ink-muted">/h</span>
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium text-ink">Margin</span>
            <div className="flex flex-wrap items-center gap-1">
              {[30, 40, 50, 60].map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={marginPct === m ? "default" : "outline"}
                  className="h-9 px-2.5 tabular-nums"
                  disabled={locked}
                  onClick={() => setMarginPct(m)}
                >
                  {m}%
                </Button>
              ))}
              <Input
                aria-label="Margin percent"
                type="number"
                min={0}
                max={95}
                step={5}
                className="h-9 w-16 tabular-nums"
                disabled={locked}
                value={marginPct}
                onChange={(e) => setMarginPct(Math.max(0, Math.min(95, Number(e.target.value) || 0)))}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Switch
                id={`override-${quote.id}`}
                disabled={locked}
                checked={override !== null}
                onCheckedChange={(on) => setOverride(on ? Math.max(1, Math.round(totals?.price_total ?? quote.price_total)) : null)}
              />
              <Label htmlFor={`override-${quote.id}`} className="text-xs">Set the total myself</Label>
            </div>
            {override !== null ? (
              <div className="flex items-center gap-1">
                <span className="text-sm text-ink-muted">$</span>
                <Input
                  aria-label="Total charged"
                  type="number"
                  min={1}
                  step={5}
                  className="h-9 w-28 font-semibold tabular-nums"
                  disabled={locked}
                  value={override}
                  onChange={(e) => setOverride(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            ) : (
              <span className="h-9 text-xs leading-9 text-ink-muted">crew pay ÷ (1 − margin){costTotal > 0 ? " + costs" : ""}</span>
            )}
          </div>
          {job ? (
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <Switch id={`owners-${quote.id}`} checked={ownersWorking} disabled={pending} onCheckedChange={(on) => setOwners(on)} />
                <Label htmlFor={`owners-${quote.id}`} className="flex items-center gap-1 text-xs">
                  <Crown className="size-3.5" aria-hidden="true" /> Owners doing it
                </Label>
              </div>
              <span className="h-9 text-xs leading-9 text-ink-muted">{ownersWorking ? "no crew pay: all take-home" : "crew pay comes out"}</span>
            </div>
          ) : null}
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

      {/* Property: tucked away, open it to change the lot or re-estimate hours */}
      <details className="group rounded-lg border border-ink/10 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
          <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="font-semibold text-ink">Property</span>
          <span className="min-w-0 flex-1 truncate text-ink-muted">
            {property.address ?? "No address on file"} · {property.lot_acres !== null ? `${property.lot_acres} acres` : "lot size unknown"}
            {property.tree_cover ? ` · ${property.tree_cover} trees` : ""}
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-3 border-t border-ink/10 p-4 md:grid-cols-[1fr_16rem]">
          <PropertyMap lat={property.lat} lng={property.lng} parcelId={property.parcel_id} />
          <div className="space-y-3">
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
          </div>
        </div>
      </details>
    </div>
  )
}

/**
 * The costs under one line: rentals, seed, dump fees. Hours-priced lines charge them at cost on top of
 * the labor price; a line with your own price already covers them. Either way they come out of take-home.
 */
function LineCosts({
  item,
  slug,
  fixedPrice,
  locked,
  onChange,
  onAdd,
  onAddOverseeding,
}: {
  item: EditItem
  slug: string | undefined
  fixedPrice: boolean
  locked: boolean
  onChange: (fn: (costs: EditCost[]) => EditCost[]) => void
  onAdd: (label: string) => void
  onAddOverseeding?: () => void
}) {
  const presets = costPresetsFor(slug, item.description).filter((p) => !item.costs.some((c) => c.label.toLowerCase() === p.toLowerCase()))
  const total = sumCosts(item.costs)
  // Lines with nothing to rent or buy stay quiet: just a small "+ Cost".
  if (!item.costs.length && !presets.length && !onAddOverseeding) {
    return locked ? null : (
      <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink" onClick={() => onAdd("")}>
        <Plus className="size-3" aria-hidden="true" /> Cost
      </button>
    )
  }
  return (
    <div className="mt-1.5 rounded-md bg-paper/70 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <Receipt className="size-3.5" aria-hidden="true" /> Costs
        </span>
        {item.costs.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1 rounded-md border border-ink/10 bg-white py-0.5 pl-1.5 pr-0.5">
            <Input
              aria-label="Cost name"
              className="h-7 w-36 border-0 px-1 text-xs shadow-none"
              value={c.label}
              maxLength={80}
              placeholder="What for?"
              disabled={locked}
              onChange={(e) => onChange((all) => all.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))}
            />
            <span className="text-xs text-ink-muted">$</span>
            <Input
              aria-label={`${c.label || "Cost"} amount`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              className="h-7 w-20 px-1 text-right text-xs tabular-nums"
              value={c.amount || ""}
              placeholder="0"
              disabled={locked}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange((all) => all.map((x) => (x.key === c.key ? { ...x, amount: Number.isFinite(v) && v > 0 ? v : 0 } : x)))
              }}
            />
            {!locked ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Remove ${c.label || "cost"}`}
                onClick={() => onChange((all) => all.filter((x) => x.key !== c.key))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </span>
        ))}
        {!locked
          ? presets.map((p) => (
              <Button key={p} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onAdd(p)}>
                <Plus className="size-3" aria-hidden="true" /> {p}
              </Button>
            ))
          : null}
        {!locked ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAdd("")}>
            <Plus className="size-3" aria-hidden="true" /> Other
          </Button>
        ) : null}
        {!locked && onAddOverseeding ? (
          <Button type="button" size="sm" variant="outline" className="h-7 border-brand-green/40 px-2 text-xs text-brand-green-dark" onClick={onAddOverseeding}>
            <Sprout className="size-3" aria-hidden="true" /> Add overseeding
          </Button>
        ) : null}
        {total > 0 ? (
          <span className="ml-auto text-xs tabular-nums text-ink-muted">
            {money(total)} {fixedPrice ? "out of your price" : "added to the price"}
          </span>
        ) : null}
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
          costs: sumCosts(i.costs),
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
