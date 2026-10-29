import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { CopyButton } from "@/components/admin/inbox/copy-button"
import { dateTime, label, money } from "@/components/admin/inbox/format"
import { QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { QuoteEditor } from "@/components/admin/quotes/quote-editor"
import { RefundButton } from "@/components/admin/quotes/refund-button"
import { StatusTimeline } from "@/components/admin/quotes/status-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { getSettings } from "@/lib/ops/settings"
import { taxConfig } from "@/lib/stripe/tax"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quote review" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JOB_LABEL: Record<string, string> = {
  unscheduled: "Needs a day",
  proposed: "On the calendar, call to confirm",
  crew_confirmed: "Crew free, call to confirm",
  booked: "Confirmed with customer",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
}

export default async function QuotePage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!UUID.test(params.id)) notFound()
  const db = requireSupabaseAdmin()
  const quote = check(await db.from("quotes").select("*").eq("id", params.id).maybeSingle(), "quote")
  if (!quote) notFound()

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

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/quotes">
          <ArrowLeft aria-hidden="true" /> Quotes
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Quote for {customer?.name ?? "customer"} <QuoteStatusBadge status={quote.status} />
          </span>
        }
        description={
          <>
            {customer?.email ?? "No email"} · {customer?.phone ?? "No phone"} ·{" "}
            <Link className="underline" href={`/admin/leads/${quote.lead_id}`}>
              View lead
            </Link>
          </>
        }
        actions={canRefund ? <RefundButton quoteId={quote.id} amount={quote.price_total} /> : null}
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
                  <Link className="mt-2 inline-block text-xs underline" href={`/admin/leads/${lead.id}`}>
                    {lead.photo_paths.length} photo{lead.photo_paths.length === 1 ? "" : "s"} on the lead
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {quote.rationale ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
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
