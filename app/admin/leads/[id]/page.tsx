import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { dateTime, label, money } from "@/components/admin/inbox/format"
import { signLeadPhotos } from "@/components/admin/inbox/load-context"
import { PhotoGallery } from "@/components/admin/inbox/photo-gallery"
import { FlyerCredit } from "@/components/admin/leads/flyer-credit"
import { LeadActions } from "@/components/admin/leads/lead-actions"
import { LeadStatusBadge, QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lead" }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{v}</dd>
    </div>
  )
}

export default async function LeadPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!UUID.test(params.id)) notFound()
  const db = requireSupabaseAdmin()
  const lead = check(await db.from("leads").select("*").eq("id", params.id).maybeSingle(), "lead")
  if (!lead) notFound()

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

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/leads">
          <ArrowLeft aria-hidden="true" /> Leads
        </Link>
      </Button>
      <PageHeader
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
                  <Link href={`/admin/quotes/${q.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline">
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
