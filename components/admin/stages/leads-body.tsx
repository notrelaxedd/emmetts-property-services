import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Camera, ChevronRight, UserSearch } from "lucide-react"
import { dateTime, label, money } from "@/components/admin/inbox/format"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { signLeadPhotos } from "@/components/admin/inbox/load-context"
import { PhotoGallery } from "@/components/admin/inbox/photo-gallery"
import { FlyerCredit } from "@/components/admin/leads/flyer-credit"
import { LeadActions } from "@/components/admin/leads/lead-actions"
import { LeadStatusBadge, QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Customer, Lead, LeadStatus, Quote } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"
import { MissingRecord } from "./missing-record"
import { stageHref, UUID_RE } from "./stages"

const STATUSES: LeadStatus[] = ["new", "quoting", "quoted", "won", "lost", "spam"]
/** Leads still waiting on a quote: what the front page's Leads stage lists. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "quoting"]
const LIMIT = 300

export function parseLeadStatus(v: string | undefined): LeadStatus | "all" {
  return (STATUSES as string[]).includes(v ?? "") ? (v as LeadStatus) : "all"
}

function preview(s: string | null, n = 80): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** "123 Main St" from "123 Main St, Bay Village, OH 44140". */
function street(address: string | null | undefined): string | null {
  if (!address) return null
  return address.split(",")[0]?.trim() || address
}

/**
 * The Leads page body (`/admin/leads`). `variant="panel"` is the front page's Leads stage: open leads
 * only (new / quoting), newest first, each row one tap into the lead's detail on the front page.
 */
export async function LeadsBody({ status, variant = "page" }: { status: LeadStatus | "all"; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  const db = getSupabaseAdmin()

  let leads: Lead[] = []
  let customers = new Map<string, Pick<Customer, "id" | "name" | "address">>()
  let serviceNames = new Map<string, string>()
  let quotesByLead = new Map<string, Pick<Quote, "id" | "lead_id" | "status" | "price_total" | "created_at">>()
  let error: string | null = db ? null : "Supabase isn't configured."

  if (db) {
    try {
      let q = db.from("leads").select("*").order("created_at", { ascending: false }).limit(LIMIT)
      if (panel) q = q.in("status", OPEN_LEAD_STATUSES)
      leads = check(await q, "leads") ?? []
      const customerIds = Array.from(new Set(leads.map((l) => l.customer_id)))
      const leadIds = leads.map((l) => l.id)
      const [c, s, qs] = await Promise.all([
        customerIds.length ? db.from("customers").select("id,name,address").in("id", customerIds) : null,
        db.from("services").select("id,name"),
        leadIds.length && !panel
          ? db.from("quotes").select("id,lead_id,status,price_total,created_at").in("lead_id", leadIds).order("created_at", { ascending: true })
          : null,
      ])
      customers = new Map((c ? (check(c, "lead customers") ?? []) : []).map((x) => [x.id, x]))
      serviceNames = new Map((check(s, "services") ?? []).map((x) => [x.id, x.name]))
      // Ascending order, so the latest quote per lead wins.
      quotesByLead = new Map((qs ? (check(qs, "lead quotes") ?? []) : []).map((x) => [x.lead_id, x]))
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  const services = (l: Lead) =>
    l.requested_service_ids.length ? l.requested_service_ids.map((id) => serviceNames.get(id) ?? "Unknown").join(", ") : null

  if (panel) {
    return (
      <div className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {leads.length ? (
          <ul className="divide-y divide-ink/10 overflow-hidden rounded-lg border border-ink/10 bg-white">
            {leads.map((l) => {
              const c = customers.get(l.customer_id)
              const note = preview(l.custom_request, 90)
              return (
                <li key={l.id}>
                  <Link
                    href={stageHref("leads", { id: l.id })}
                    scroll={false}
                    className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-brand-green/10 focus-visible:bg-brand-green/10 sm:px-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{c?.name ?? "Unknown"}</span>
                        <LeadStatusBadge status={l.status} />
                        {l.photo_paths.length ? (
                          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                            <Camera className="size-3.5" aria-hidden="true" />
                            {l.photo_paths.length}
                            <span className="sr-only"> photo{l.photo_paths.length === 1 ? "" : "s"}</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-body">
                        {[services(l), street(c?.address)].filter(Boolean).join(" · ") || "No services picked"}
                      </span>
                      {note ? <span className="mt-0.5 block truncate text-xs text-ink-muted">&ldquo;{note}&rdquo;</span> : null}
                    </span>
                    <span className="hidden shrink-0 text-xs text-ink-muted sm:block">{dateTime(l.created_at)}</span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState icon={UserSearch} title="No one waiting on a quote" description="New quote-form submissions show up here." />
        )}
      </div>
    )
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length])) as Record<LeadStatus, number>
  const shown = status === "all" ? leads : leads.filter((l) => l.status === status)

  return (
    <div className="space-y-4">
      <PageHeader title="Leads" description={`Quote-form submissions, newest first (last ${LIMIT}).`} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <UrlFilterChips
        param="status"
        ariaLabel="Filter leads by status"
        value={status}
        chips={[
          { value: "all", label: "All", count: leads.length },
          ...STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1), count: counts[s] })),
        ]}
      />
      {shown.length ? (
        <div className="rounded-lg border border-ink/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Custom request</TableHead>
                <TableHead className="text-center">Photos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Quote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((l) => {
                const c = customers.get(l.customer_id)
                const q = quotesByLead.get(l.id)
                return (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-ink-muted">
                      <Link href={`/admin/leads/${l.id}`} className="hover:underline">
                        {dateTime(l.created_at)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/leads/${l.id}`} className="font-medium text-ink hover:underline">
                        {c?.name ?? "Unknown"}
                      </Link>
                      {c?.address ? <div className="text-xs text-ink-muted">{c.address}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm">{services(l) ?? "—"}</TableCell>
                    <TableCell className="max-w-[16rem] text-sm text-ink-muted">{preview(l.custom_request) ?? "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {l.photo_paths.length ? (
                        <span className="inline-flex items-center gap-1">
                          <Camera className="size-3.5" aria-hidden="true" />
                          {l.photo_paths.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <LeadStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {q ? (
                        <Link href={`/admin/quotes/${q.id}`} className="inline-flex items-center gap-2 hover:underline">
                          <span className="tabular-nums">{money(q.price_total)}</span>
                          <QuoteStatusBadge status={q.status} />
                        </Link>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={UserSearch} title="No leads" description="Quote-form submissions show up here." />
      )}
    </div>
  )
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{v}</dd>
    </div>
  )
}

/**
 * One lead (`/admin/leads/[id]`): the request, who the customer is, its quotes and the triage actions.
 * `variant="panel"` is the same inside the front page's Leads stage (back link and quote links stay there).
 * Calls `notFound()` for a bad or missing id.
 */
export async function LeadDetailBody({ id, variant = "page" }: { id: string; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  if (!UUID_RE.test(id)) return panel ? <MissingRecord stage="leads" what="lead" /> : notFound()
  const db = requireSupabaseAdmin()
  const lead = check(await db.from("leads").select("*").eq("id", id).maybeSingle(), "lead")
  if (!lead) return panel ? <MissingRecord stage="leads" what="lead" /> : notFound()

  const [customerRes, servicesRes, quotesRes, photos, flyerRes] = await Promise.all([
    db.from("customers").select("*").eq("id", lead.customer_id).maybeSingle(),
    lead.requested_service_ids.length
      ? db.from("services").select("id,name").in("id", lead.requested_service_ids)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    db.from("quotes").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
    signLeadPhotos(db, lead.photo_paths),
    db.from("flyer_workers").select("id,name,code,removed_at").order("name"),
  ])
  const customer = check(customerRes, "lead customer")
  const services = check(servicesRes, "lead services") ?? []
  const quotes = check(quotesRes, "lead quotes") ?? []
  // Removed flyer workers stay pickable only if this lead is already theirs.
  const flyerWorkers = (check(flyerRes, "flyer workers") ?? []).filter((w) => !w.removed_at || w.id === lead.flyer_worker_id)
  const utm = Object.entries(lead.utm ?? {}).filter(([, v]) => !!v)
  const quoteHref = (quoteId: string) => (panel ? stageHref("quotes", { id: quoteId }) : `/admin/quotes/${quoteId}`)

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={panel ? stageHref("leads") : "/admin/leads"} scroll={panel ? false : undefined}>
          <ArrowLeft aria-hidden="true" /> {panel ? "All leads" : "Leads"}
        </Link>
      </Button>
      <PageHeader
        as={panel ? "h3" : "h1"}
        title={customer?.name ?? "Lead"}
        description={`Submitted ${dateTime(lead.created_at)} via ${lead.source || "quote form"}`}
        actions={<LeadActions leadId={lead.id} status={lead.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Request <LeadStatusBadge status={lead.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-ink/10">
              <Row k="Services" v={services.length ? services.map((s) => s.name).join(", ") : "—"} />
              <Row k="Something else" v={<span className="whitespace-pre-line">{lead.custom_request || "—"}</span>} />
              <Row
                k="Preferred days"
                v={lead.preferred_days.length ? lead.preferred_days.map((d) => WEEKDAYS[d] ?? d).join(", ") : "Any"}
              />
              <Row k="Source" v={lead.source || "—"} />
              <Row k="UTM" v={utm.length ? utm.map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"} />
              {flyerWorkers.length ? (
                <Row k="Flyer worker" v={<FlyerCredit leadId={lead.id} current={lead.flyer_worker_id} workers={flyerWorkers} />} />
              ) : null}
            </dl>
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Photos ({photos.length})</p>
              <PhotoGallery photos={photos} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent>
            {customer ? (
              <dl className="divide-y divide-ink/10">
                <Row k="Name" v={customer.name} />
                <Row k="Email" v={customer.email ? <a className="underline" href={`mailto:${customer.email}`}>{customer.email}</a> : "—"} />
                <Row k="Phone" v={customer.phone ? <a className="underline" href={`tel:${customer.phone}`}>{customer.phone}</a> : "—"} />
                <Row k="Address" v={customer.address ?? "—"} />
                <Row k="Lot" v={customer.lot_acres !== null ? `${customer.lot_acres} acres` : "Unknown"} />
                <Row k="Tree cover" v={label(customer.tree_cover)} />
                <Row
                  k="Opt-ins"
                  v={[customer.email_opt_in && "Email", customer.sms_opt_in && "Texts", customer.snow_list && "Snow list"]
                    .filter(Boolean)
                    .join(", ") || "None"}
                />
                <Row k="Notes" v={<span className="whitespace-pre-line">{customer.notes || "—"}</span>} />
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">Customer record missing.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quotes</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length ? (
            <ul className="divide-y divide-ink/10">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={quoteHref(q.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                    <span className="text-sm text-ink-muted">{dateTime(q.created_at)}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-ink">{money(q.price_total)}</span>
                      <QuoteStatusBadge status={q.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No quote yet. The quotes worker usually has one within a few minutes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
