import Link from "next/link"
import { NotebookPen, Search } from "lucide-react"
import { CustomersTabs } from "@/components/admin/customers/customers-tabs"
import { LogInteractionForm } from "@/components/admin/customers/log-interaction-form"
import { PriceLogTable, type PriceLogRow } from "@/components/admin/customers/price-log-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { CustomerInteraction } from "@/lib/db/types"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Price log" }

const LIMIT = 300
const SHOWS = [
  { key: "all", label: "All" },
  { key: "open", label: "Waiting on them" },
  { key: "due", label: "Follow-ups due" },
] as const
type Show = (typeof SHOWS)[number]["key"]

async function load(q: string, show: Show, today: string) {
  const db = requireSupabaseAdmin()
  let query = db
    .from("customer_interactions")
    .select("*")
    .order("talked_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT)
  if (show !== "all") query = query.eq("status", "open")
  if (show === "due") query = query.lte("follow_up_on", today)

  // PostgREST `or` syntax: strip characters that would break the filter list.
  const term = q.replace(/[,()*%\\:"']/g, " ").trim()
  if (term) {
    const like = `%${term}%`
    const digits = term.replace(/\D/g, "")
    const ors = [`name.ilike.${like}`, `phone.ilike.${like}`]
    if (digits.length >= 3 && digits !== term) ors.push(`phone.ilike.%${digits}%`)
    const matches = await db.from("customers").select("id").or(ors.join(",")).limit(200)
    if (matches.error) throw new Error(matches.error.message)
    const ids = (matches.data ?? []).map((c) => c.id)
    query = query.or([`category.ilike.${like}`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : [])].join(","))
  }

  const [entries, due, used] = await Promise.all([
    query,
    db.from("customer_interactions").select("id", { count: "exact", head: true }).eq("status", "open").lte("follow_up_on", today),
    db.from("customer_interactions").select("category").order("created_at", { ascending: false }).limit(500),
  ])
  for (const r of [entries, due, used]) if (r.error) throw new Error(r.error.message)
  const list = (entries.data ?? []) as CustomerInteraction[]

  const customerIds = Array.from(new Set(list.map((e) => e.customer_id)))
  const customers = customerIds.length
    ? await db.from("customers").select("id,name,phone").in("id", customerIds)
    : { data: [] as { id: string; name: string; phone: string | null }[], error: null }
  if (customers.error) throw new Error(customers.error.message)
  const byId = new Map((customers.data ?? []).map((c) => [c.id, c]))

  const rows: PriceLogRow[] = list.map((e) => ({
    id: e.id,
    talked_on: e.talked_on,
    category: e.category,
    price: e.price === null ? null : Number(e.price),
    notes: e.notes,
    follow_up_on: e.follow_up_on,
    status: e.status,
    customer: byId.get(e.customer_id),
  }))
  const categories = Array.from(new Set((used.data ?? []).map((u) => u.category.trim()))).slice(0, 30)
  return { rows, dueCount: due.count ?? 0, categories }
}

export default async function PriceLogPage({ searchParams }: { searchParams: { q?: string; show?: string } }) {
  await requireOwner()
  const q = typeof searchParams.q === "string" ? searchParams.q.slice(0, 100) : ""
  const show: Show = SHOWS.some((s) => s.key === searchParams.show) ? (searchParams.show as Show) : "all"
  const today = localDate(new Date())
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(q, show, today)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const href = (s: Show, withQ = true) => {
    const p = new URLSearchParams()
    if (s !== "all") p.set("show", s)
    if (q && withQ) p.set("q", q)
    const qs = p.toString()
    return `/admin/customers/log${qs ? `?${qs}` : ""}`
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" description="Every price you've given, so the next quote matches the last one." />
      <CustomersTabs active="log" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log a conversation</CardTitle>
          <CardDescription>Type the phone number first: if they’re already on file, you’ll see what they were quoted before.</CardDescription>
        </CardHeader>
        <CardContent>
          <LogInteractionForm today={today} categories={data?.categories} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {SHOWS.map((s) => (
            <Link
              key={s.key}
              href={href(s.key)}
              aria-current={s.key === show ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
                s.key === show ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-accent",
              )}
            >
              {s.label}
              {s.key === "due" && data?.dueCount ? (
                <span className="rounded-full bg-amber-200 px-1.5 text-xs font-semibold text-amber-950">{data.dueCount}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex w-full max-w-md gap-2" role="search">
          {show !== "all" ? <input type="hidden" name="show" value={show} /> : null}
          <Input name="q" defaultValue={q} placeholder="Search name, phone or what about" aria-label="Search the price log" />
          <Button type="submit" variant="outline">
            <Search /> Search
          </Button>
          {q ? (
            <Button asChild variant="ghost">
              <Link href={href(show, false)}>Clear</Link>
            </Button>
          ) : null}
        </form>
      </div>

      {error || !data ? (
        <EmptyState icon={NotebookPen} title="Couldn't load the price log" description={error ?? undefined} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={q || show !== "all" ? "Nothing here" : "Nothing logged yet"}
          description={
            q ? `Nothing matches "${q}".` : show === "due" ? "No follow-ups are due." : "Log a call or a chat above and it shows up here."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <PriceLogTable rows={data.rows} today={today} />
          {data.rows.length >= LIMIT ? (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">Showing the newest {LIMIT}. Search to narrow it down.</p>
          ) : null}
        </Card>
      )}
    </div>
  )
}
