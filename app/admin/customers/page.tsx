import Link from "next/link"
import { Search, UserRound } from "lucide-react"
import { day, formatPhone, titleCase } from "@/components/admin/customers/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { Customer, JobStatus } from "@/lib/db/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customers" }

const LIMIT = 200

async function load(q: string) {
  const db = requireSupabaseAdmin()
  let query = db.from("customers").select("*").order("created_at", { ascending: false }).limit(LIMIT)
  // PostgREST `or` syntax: strip characters that would break the filter list.
  const term = q.replace(/[,()*%\\:"']/g, " ").trim()
  if (term) {
    const like = `%${term}%`
    const digits = term.replace(/\D/g, "")
    const ors = [`name.ilike.${like}`, `address.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`]
    if (digits.length >= 3 && digits !== term) ors.push(`phone.ilike.%${digits}%`)
    query = query.or(ors.join(","))
  }
  const customers = await query
  if (customers.error) throw new Error(customers.error.message)
  const rows: Customer[] = customers.data ?? []

  const ids = rows.map((c) => c.id)
  const jobs = ids.length
    ? await db.from("jobs").select("customer_id,status,start_at,completed_at,created_at").in("customer_id", ids)
    : { data: [] as { customer_id: string; status: JobStatus; start_at: string | null; completed_at: string | null; created_at: string }[], error: null }
  if (jobs.error) throw new Error(jobs.error.message)

  const last = new Map<string, { when: string; status: JobStatus }>()
  for (const j of jobs.data ?? []) {
    if (j.status === "cancelled") continue
    const when = j.completed_at ?? j.start_at ?? j.created_at
    const prev = last.get(j.customer_id)
    if (!prev || when > prev.when) last.set(j.customer_id, { when, status: j.status })
  }
  return { rows, last }
}

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireOwner()
  const q = typeof searchParams.q === "string" ? searchParams.q.slice(0, 100) : ""
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(q)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" description="Everyone who has asked for a quote." />
      <form method="get" className="flex max-w-xl gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name, address, phone or email" aria-label="Search customers" />
        <Button type="submit" variant="outline">
          <Search /> Search
        </Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href="/admin/customers">Clear</Link>
          </Button>
        ) : null}
      </form>

      {error || !data ? (
        <EmptyState icon={UserRound} title="Couldn't load customers" description={error ?? undefined} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={q ? "No matches" : "No customers yet"}
          description={q ? `Nothing matches "${q}".` : "Customers are added when someone fills in the quote form."}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Address</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead>Opt-ins</TableHead>
                <TableHead className="hidden lg:table-cell">Last job</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((c) => {
                const last = data!.last.get(c.id)
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-muted">{c.email ?? ""}</p>
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] truncate md:table-cell">{c.address ?? "—"}</TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">{c.phone ? formatPhone(c.phone) : "—"}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {c.email_opt_in ? <Badge variant="secondary">Email</Badge> : null}
                        {c.sms_opt_in ? <Badge variant="secondary">SMS</Badge> : null}
                        {c.snow_list ? <Badge variant="outline">❄ Snow</Badge> : null}
                        {!c.email_opt_in && !c.sms_opt_in && !c.snow_list ? <span className="text-xs text-ink-muted">None</span> : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {last ? `${day(last.when)} · ${titleCase(last.status)}` : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {data.rows.length >= LIMIT ? (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">Showing the newest {LIMIT}. Search to narrow it down.</p>
          ) : null}
        </Card>
      )}
    </div>
  )
}
