import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ChevronRight, ExternalLink, Receipt } from "lucide-react"
import { CopyButton } from "@/components/admin/inbox/copy-button"
import { dateTime, label, money } from "@/components/admin/inbox/format"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { DeleteQuoteButton } from "@/components/admin/quotes/delete-quote-button"
import { QuoteEditor } from "@/components/admin/quotes/quote-editor"
import { RefundButton } from "@/components/admin/quotes/refund-button"
import { StatusTimeline } from "@/components/admin/quotes/status-timeline"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Quote, QuoteStatus } from "@/lib/db/types"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import { taxConfig } from "@/lib/stripe/tax"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"
import { MissingRecord } from "./missing-record"
import { stageHref, UUID_RE } from "./stages"

const STATUSES: QuoteStatus[] = ["needs_owner", "draft", "sent", "accepted", "expired", "declined"]
/** Quotes still being worked out: what the front page's Quotes stage lists. */
export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ["needs_owner", "draft"]
const LABELS: Record<QuoteStatus, string> = {
  needs_owner: "Needs you",
  draft: "Estimated",
  sent: "Pay link out",
  accepted: "Confirmed",
  expired: "Expired",
  declined: "Declined",
}
const PAY_LABEL: Record<string, string> = { cash: "cash", check: "check", stripe: "card" }
const LIMIT = 300

export function parseQuoteStatus(v: string | undefined): QuoteStatus | "all" {
  return (STATUSES as string[]).includes(v ?? "") ? (v as QuoteStatus) : "all"
}

function paymentText(q: Quote): string {
  return q.paid_at
    ? `Paid${q.payment_method ? ` by ${PAY_LABEL[q.payment_method] ?? q.payment_method}` : ""} · ${dateTime(q.paid_at)}`
    : q.status === "accepted"
      ? `After the job${q.payment_method ? ` by ${PAY_LABEL[q.payment_method] ?? q.payment_method}` : ""}`
      : q.sent_at
        ? `Link sent ${dateTime(q.sent_at)}`
        : "—"
}

/**
 * The Quotes page body (`/admin/quotes`). `variant="panel"` is the front page's Quotes stage: open quotes
 * (estimated / needs you), customer + line items, labor, profit, price and payment, each row one tap
 * into the quote on the front page.
 */
export async function QuotesBody({ status, variant = "page" }: { status: QuoteStatus | "all"; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  const db = getSupabaseAdmin()

  let quotes: Quote[] = []
  let names = new Map<string, { name: string; address: string | null }>()
  let linesByQuote = new Map<string, string[]>()
  let error: string | null = db ? null : "Supabase isn't configured."
  if (db) {
    try {
      let q = db.from("quotes").select("*").order("created_at", { ascending: false }).limit(LIMIT)
      if (panel) q = q.in("status", OPEN_QUOTE_STATUSES)
      quotes = check(await q, "quotes") ?? []
      const ids = Array.from(new Set(quotes.map((q) => q.customer_id)))
      const quoteIds = quotes.map((q) => q.id)
      const [rows, items] = await Promise.all([
        ids.length ? db.from("customers").select("id,name,address").in("id", ids) : null,
        panel && quoteIds.length ? db.from("quote_items").select("quote_id,description,sort_order").in("quote_id", quoteIds) : null,
      ])
      if (rows) names = new Map((check(rows, "quote customers") ?? []).map((c) => [c.id, { name: c.name, address: c.address }]))
      if (items) {
        linesByQuote = new Map()
        for (const i of (check(items, "quote items") ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
          linesByQuote.set(i.quote_id, [...(linesByQuote.get(i.quote_id) ?? []), i.description])
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  if (panel) {
    return (
      <div className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {quotes.length ? (
          <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_5.5rem_5.5rem_5.5rem_9rem_1rem] gap-3 border-b border-ink/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted md:grid">
              <span>Customer</span>
              <span>Status</span>
              <span className="text-right">Labor</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Price</span>
              <span>Payment</span>
              <span />
            </div>
            <ul className="divide-y divide-ink/10">
              {quotes.map((q) => {
                const c = names.get(q.customer_id)
                const lines = linesByQuote.get(q.id) ?? []
                return (
                  <li key={q.id}>
                    <Link
                      href={stageHref("quotes", { id: q.id })}
                      scroll={false}
                      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-brand-green/10 focus-visible:bg-brand-green/10 sm:px-4 md:grid-cols-[minmax(0,1fr)_7rem_5.5rem_5.5rem_5.5rem_9rem_1rem]"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{c?.name ?? "Unknown"}</span>
                        <span className="block truncate text-xs text-ink-muted">{lines.length ? lines.join(", ") : "No line items yet"}</span>
                      </span>
                      <span className="justify-self-end md:justify-self-start">
                        <QuoteStatusBadge status={q.status} />
                      </span>
                      <span className="col-span-2 flex flex-wrap gap-x-3 text-xs text-ink-muted md:contents md:text-sm">
                        <span className="tabular-nums md:text-right">
                          <span className="md:sr-only">Labor </span>
                          {money(q.labor_total)}
                        </span>
                        <span className="tabular-nums md:text-right">
                          <span className="md:sr-only">Profit </span>
                          {money(q.profit_total)}
                        </span>
                        <span className="font-semibold tabular-nums text-ink md:text-right">
                          <span className="font-normal text-ink-muted md:sr-only">Price </span>
                          {money(q.price_total)}
                        </span>
                        <span className="md:truncate">{paymentText(q)}</span>
                      </span>
                      <ChevronRight className="hidden size-4 text-ink-muted md:block" aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <EmptyState icon={Receipt} title="No open quotes" description="The quotes worker estimates one for every lead; once confirmed by phone it moves on to the schedule." />
        )}
      </div>
    )
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, quotes.filter((q) => q.status === s).length])) as Record<QuoteStatus, number>
  const shown = status === "all" ? quotes : quotes.filter((q) => q.status === status)
  const sum = (s: QuoteStatus) => quotes.filter((q) => q.status === s).reduce((a, q) => a + q.price_total, 0)
  const toCollect = quotes.filter((q) => q.status === "accepted" && !q.paid_at)
  const paid = quotes.filter((q) => !!q.paid_at)

  return (
    <div className="space-y-4">
      <PageHeader title="Quotes" description={`Newest first (last ${LIMIT}). Estimated quotes wait on the schedule's rail; you confirm them by phone and collect after the job.`} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Needs you" value={counts.needs_owner} hint={money(sum("needs_owner"))} />
        <Stat label="Confirmed, to collect" value={toCollect.length} hint={money(toCollect.reduce((a, q) => a + q.price_total, 0))} />
        <Stat label="Paid" value={paid.length} hint={money(paid.reduce((a, q) => a + q.price_total, 0))} />
        <Stat label="Expired / declined" value={counts.expired + counts.declined} />
      </div>
      <UrlFilterChips
        param="status"
        ariaLabel="Filter quotes by status"
        value={status}
        chips={[
          { value: "all", label: "All", count: quotes.length },
          ...STATUSES.map((s) => ({ value: s, label: LABELS[s], count: counts[s] })),
        ]}
      />
      {shown.length ? (
        <div className="rounded-lg border border-ink/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Labor</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="w-10 text-right">
                  <span className="sr-only">Delete</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((q) => {
                const c = names.get(q.customer_id)
                return (
                  <TableRow key={q.id}>
                    <TableCell className="whitespace-nowrap text-ink-muted">{dateTime(q.created_at)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/quotes/${q.id}`} className="font-medium text-ink hover:underline">
                        {c?.name ?? "Unknown"}
                      </Link>
                      {c?.address ? <div className="text-xs text-ink-muted">{c.address}</div> : null}
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(q.labor_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(q.profit_total)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-ink">{money(q.price_total)}</TableCell>
                    <TableCell className="whitespace-nowrap text-ink-muted">{paymentText(q)}</TableCell>
                    <TableCell className="text-right">
                      <DeleteQuoteButton quoteId={q.id} customerName={c?.name ?? "this customer"} amount={q.price_total} paid={!!q.paid_at} compact />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Receipt} title="No quotes here" description="The quotes worker estimates one for every lead; it then waits on the schedule's rail for a day." />
      )}
    </div>
  )
}

const JOB_LABEL: Record<string, string> = {
  unscheduled: "Needs a day",
  proposed: "On the calendar, call to confirm",
  crew_confirmed: "Crew free, call to confirm",
  booked: "Confirmed with customer",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
}

/**
 * One quote (`/admin/quotes/[id]`): the editor (lines, crew, hours, price, payment) and the aside
 * (status, links, job, customer note, why this price, approvals). `variant="panel"` is the same inside
 * the front page's Quotes stage. Calls `notFound()` for a bad or missing id.
 */
export async function QuoteDetailBody({ id, variant = "page" }: { id: string; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  if (!UUID_RE.test(id)) return panel ? <MissingRecord stage="quotes" what="quote" /> : notFound()
  const db = requireSupabaseAdmin()
  const quote = check(await db.from("quotes").select("*").eq("id", id).maybeSingle(), "quote")
  if (!quote) return panel ? <MissingRecord stage="quotes" what="quote" /> : notFound()

  const [itemsRes, customerRes, leadRes, servicesRes, approvalsRes, jobRes, settings] = await Promise.all([
    db.from("quote_items").select("*").eq("quote_id", quote.id).order("sort_order", { ascending: true }),
    db.from("customers").select("*").eq("id", quote.customer_id).maybeSingle(),
    db.from("leads").select("id,custom_request,photo_paths,status").eq("id", quote.lead_id).maybeSingle(),
    db.from("services").select("id,name,minutes_rule").order("sort_order", { ascending: true }),
    db
      .from("approvals")
      .select("*")
      .in("kind", ["quote", "custom_item"])
      .or(`ref_id.eq.${quote.id},payload->>quote_id.eq.${quote.id}`)
      .order("created_at", { ascending: true }),
    db.from("jobs").select("id,status,start_at,completed_at").eq("quote_id", quote.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    getSettings(db),
  ])
  const items = check(itemsRes, "quote items") ?? []
  const customer = check(customerRes, "quote customer")
  const lead = check(leadRes, "quote lead")
  const services = check(servicesRes, "services") ?? []
  const job = check(jobRes, "quote job")
  const itemIds = new Set(items.map((i) => i.id))
  const related = (check(approvalsRes, "quote approvals") ?? []).filter(
    (a) =>
      (a.kind === "quote" && a.ref_id === quote.id) ||
      (a.kind === "custom_item" && (a.payload.quote_id === quote.id || itemIds.has(a.ref_id))),
  )
  const ownerCardAt = related.find((a) => a.kind === "quote")?.created_at ?? null
  const pendingCustomItemIds = related
    .filter((a) => a.kind === "custom_item" && a.status === "pending")
    .map((a) => (typeof a.payload.quote_item_id === "string" ? a.payload.quote_item_id : a.ref_id))
  const canRefund = !!quote.paid_at && !!quote.stripe_payment_intent_id
  const leadHref = panel ? stageHref("leads", { id: quote.lead_id }) : `/admin/leads/${quote.lead_id}`

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={panel ? stageHref("quotes") : "/admin/quotes"} scroll={panel ? false : undefined}>
          <ArrowLeft aria-hidden="true" /> {panel ? "All quotes" : "Quotes"}
        </Link>
      </Button>
      <PageHeader
        as={panel ? "h3" : "h1"}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Quote for {customer?.name ?? "customer"} <QuoteStatusBadge status={quote.status} />
          </span>
        }
        description={
          <>
            {customer?.email ?? "No email"} · {customer?.phone ?? "No phone"} ·{" "}
            {panel ? <>{customer?.address ?? "No address"} · </> : null}
            <Link className="underline" href={leadHref} scroll={panel ? false : undefined}>
              View lead
            </Link>
          </>
        }
        actions={
          <>
            {canRefund ? <RefundButton quoteId={quote.id} amount={quote.price_total} /> : null}
            <DeleteQuoteButton
              quoteId={quote.id}
              customerName={customer?.name ?? "this customer"}
              amount={quote.price_total}
              paid={!!quote.paid_at}
              redirectTo={panel ? stageHref("quotes") : "/admin/quotes"}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <QuoteEditor
          key={quote.updated_at}
          quote={quote}
          items={items}
          property={{
            address: customer?.address ?? null,
            lat: customer?.lat ?? null,
            lng: customer?.lng ?? null,
            lot_acres: customer?.lot_acres ?? null,
            tree_cover: customer?.tree_cover ?? null,
            parcel_id: customer?.parcel_id ?? null,
          }}
          settings={{
            default_wage: settings.default_wage,
            margin: settings.margin,
            min_job_price: settings.min_job_price,
            card_fee_pct: settings.card_fee_pct,
            card_fee_fixed: settings.card_fee_fixed,
          }}
          services={services}
          customerEmail={customer?.email ?? null}
          pendingCustomItemIds={pendingCustomItemIds}
          invoiceDaysDefault={settings.invoice_days_until_due}
          taxEnabled={taxConfig().enabled}
          job={job}
        />

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline quote={quote} ownerCardAt={ownerCardAt} />
            </CardContent>
          </Card>

          {quote.stripe_checkout_url && quote.status !== "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Checkout link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="break-all rounded bg-paper p-2 font-mono text-xs text-ink">{quote.stripe_checkout_url}</p>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={quote.stripe_checkout_url} label="Copy link" />
                  <Button asChild size="sm" variant="ghost">
                    <a href={quote.stripe_checkout_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" /> Open
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-ink-muted">Stripe test mode. Checkout links expire after about 23 hours; re-send to refresh.</p>
              </CardContent>
            </Card>
          ) : null}

          {quote.stripe_invoice_url && quote.status !== "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stripe invoice</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="break-all rounded bg-paper p-2 font-mono text-xs text-ink">{quote.stripe_invoice_url}</p>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={quote.stripe_invoice_url} label="Copy link" />
                  <Button asChild size="sm" variant="ghost">
                    <a href={quote.stripe_invoice_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" /> Open
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-ink-muted">
                  Stripe test mode. Stripe emailed it{quote.stripe_invoice_id ? ` (${quote.stripe_invoice_id})` : ""} and sends the
                  reminders; the quote is marked paid when it is paid.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {job ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Badge variant="secondary">{JOB_LABEL[job.status] ?? label(job.status)}</Badge>
                <p className="text-ink-muted">{job.start_at ? dateTime(job.start_at) : "Waiting for a day on the schedule's rail"}</p>
                <Link className="underline" href={`/admin/schedule?job=${job.id}`}>
                  Open on the schedule
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {lead?.custom_request ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Customer note</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm text-ink">{lead.custom_request}</p>
                {lead.photo_paths.length ? (
                  <Link className="mt-2 inline-block text-xs underline" href={panel ? leadHref : `/admin/leads/${lead.id}`} scroll={panel ? false : undefined}>
                    {lead.photo_paths.length} photo{lead.photo_paths.length === 1 ? "" : "s"} on the lead
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {quote.rationale ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{panel ? "Why this price" : "Notes"}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm text-ink-muted">{quote.rationale}</p>
              </CardContent>
            </Card>
          ) : null}

          {related.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Approvals</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {related.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium text-ink">{a.kind === "quote" ? "Quote" : "Custom item"}</span>{" "}
                      <Badge variant={a.status === "pending" ? "warning" : a.status === "rejected" ? "outline" : "success"}>
                        {label(a.status)}
                      </Badge>
                      <span className="block text-xs text-ink-muted">
                        {dateTime(a.decided_at ?? a.created_at)}
                        {a.decided_by ? ` · ${a.decided_by}` : ""}
                      </span>
                      {a.decision_note ? <span className="block whitespace-pre-line text-xs text-ink-muted">{a.decision_note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">
                  Total on file: <span className="font-semibold text-ink">{money(quote.price_total)}</span>
                </p>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
