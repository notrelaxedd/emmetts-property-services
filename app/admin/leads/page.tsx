import Link from "next/link"
import { Camera, UserSearch } from "lucide-react"
import { dateTime, money } from "@/components/admin/inbox/format"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { LeadStatusBadge, QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { Customer, Lead, LeadStatus, Quote } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Leads" }

const STATUSES: LeadStatus[] = ["new", "quoting", "quoted", "won", "lost", "spam"]
const LIMIT = 300

function preview(s: string | null, n = 80): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  const status = (STATUSES as string[]).includes(searchParams.status ?? "") ? (searchParams.status as LeadStatus) : "all"
  const db = getSupabaseAdmin()

  let leads: Lead[] = []
  let customers = new Map<string, Pick<Customer, "id" | "name" | "address">>()
  let serviceNames = new Map<string, string>()
  let quotesByLead = new Map<string, Pick<Quote, "id" | "lead_id" | "status" | "price_total" | "created_at">>()
  let error: string | null = db ? null : "Supabase isn't configured."

  if (db) {
    try {
      leads = check(await db.from("leads").select("*").order("created_at", { ascending: false }).limit(LIMIT), "leads") ?? []
      const customerIds = Array.from(new Set(leads.map((l) => l.customer_id)))
      const leadIds = leads.map((l) => l.id)
      const [c, s, q] = await Promise.all([
        customerIds.length ? db.from("customers").select("id,name,address").in("id", customerIds) : null,
        db.from("services").select("id,name"),
        leadIds.length
          ? db.from("quotes").select("id,lead_id,status,price_total,created_at").in("lead_id", leadIds).order("created_at", { ascending: true })
          : null,
      ])
      customers = new Map((c ? (check(c, "lead customers") ?? []) : []).map((x) => [x.id, x]))
      serviceNames = new Map((check(s, "services") ?? []).map((x) => [x.id, x.name]))
      // Ascending order, so the latest quote per lead wins.
      quotesByLead = new Map((q ? (check(q, "lead quotes") ?? []) : []).map((x) => [x.lead_id, x]))
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
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
                    <TableCell className="text-sm">
                      {l.requested_service_ids.length
                        ? l.requested_service_ids.map((id) => serviceNames.get(id) ?? "Unknown").join(", ")
                        : "—"}
                    </TableCell>
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
