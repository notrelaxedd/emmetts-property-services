import Link from "next/link"
import { Receipt } from "lucide-react"
import { dateTime, money } from "@/components/admin/inbox/format"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { QuoteStatusBadge } from "@/components/admin/leads/status-badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { Quote, QuoteStatus } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quotes" }

const STATUSES: QuoteStatus[] = ["needs_owner", "draft", "sent", "accepted", "expired", "declined"]
const LABELS: Record<QuoteStatus, string> = {
  needs_owner: "Needs you",
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  declined: "Declined",
}
const LIMIT = 300

export default async function QuotesPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  const status = (STATUSES as string[]).includes(searchParams.status ?? "") ? (searchParams.status as QuoteStatus) : "all"
  const db = getSupabaseAdmin()

  let quotes: Quote[] = []
  let names = new Map<string, { name: string; address: string | null }>()
  let error: string | null = db ? null : "Supabase isn't configured."
  if (db) {
    try {
      quotes = check(await db.from("quotes").select("*").order("created_at", { ascending: false }).limit(LIMIT), "quotes") ?? []
      const ids = Array.from(new Set(quotes.map((q) => q.customer_id)))
      if (ids.length) {
        const rows = check(await db.from("customers").select("id,name,address").in("id", ids), "quote customers") ?? []
        names = new Map(rows.map((c) => [c.id, { name: c.name, address: c.address }]))
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, quotes.filter((q) => q.status === s).length])) as Record<QuoteStatus, number>
  const shown = status === "all" ? quotes : quotes.filter((q) => q.status === status)
  const sum = (s: QuoteStatus) => quotes.filter((q) => q.status === s).reduce((a, q) => a + q.price_total, 0)

  return (
    <div className="space-y-4">
      <PageHeader title="Quotes" description={`Newest first (last ${LIMIT}).`} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Needs you" value={counts.needs_owner} hint={money(sum("needs_owner"))} />
        <Stat label="Out for payment" value={counts.sent} hint={money(sum("sent"))} />
        <Stat label="Accepted" value={counts.accepted} hint={money(sum("accepted"))} />
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
                <TableHead>Sent</TableHead>
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
                    <TableCell className="whitespace-nowrap text-ink-muted">{q.sent_at ? dateTime(q.sent_at) : "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Receipt} title="No quotes here" description="The quotes worker drafts one for every lead." />
      )}
    </div>
  )
}
