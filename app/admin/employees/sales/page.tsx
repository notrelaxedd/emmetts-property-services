import Link from "next/link"
import { Handshake } from "lucide-react"
import { EmployeesTabs } from "@/components/admin/employees/employees-tabs"
import { AddSalesRepForm } from "@/components/admin/sales/rep-forms"
import { PayAllOwedButton, RepJobsTable } from "@/components/admin/sales/rep-jobs"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { loadCommissions } from "@/lib/commissions/load"
import { emptyTotals, ratePercent, repTotals, rowsByRep } from "@/lib/commissions/stats"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sales reps" }

async function load() {
  const { reps, rows } = await loadCommissions(requireSupabaseAdmin())
  const byRep = rowsByRep(rows)
  const all = reps.map((rep) => {
    const repRows = byRep.get(rep.id) ?? []
    return { rep, rows: repRows, totals: repRows.length ? repTotals(repRows) : emptyTotals() }
  })
  // Most owed first, then whoever sold the most.
  all.sort((a, b) => b.totals.owed - a.totals.owed || b.totals.sold - a.totals.sold || a.rep.name.localeCompare(b.rep.name))
  return {
    active: all.filter((r) => !r.rep.removed_at),
    removed: all.filter((r) => r.rep.removed_at),
    total: repTotals(rows),
  }
}

export default async function SalesRepsPage({ searchParams }: { searchParams: { removed?: string } }) {
  const showRemoved = searchParams.removed === "1"
  await requireOwner()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const list = data ? (showRemoved ? [...data.active, ...data.removed] : data.active) : []

  return (
    <div className="space-y-5">
      <PageHeader title="Employees" description="Door-to-door sales reps: every job they sold, their commission, and what you've paid them." />
      <EmployeesTabs active="sales" />

      {data && (data.active.length > 0 || data.removed.length > 0) ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Jobs sold" value={data.total.leads.toLocaleString()} hint={`${data.total.completed.toLocaleString()} done`} />
          <Stat label="Sold (done jobs)" value={usd(data.total.sold)} />
          <Stat label="Paid out" value={usd(data.total.paid)} />
          <Stat label="Owed now" value={usd(data.total.owed)} hint={data.total.pending > 0 ? `${usd(data.total.pending)} more once jobs are done` : "for finished jobs"} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add sales rep</CardTitle>
          <CardDescription>They pick their name from the list on eodlawns.com/door, so every job they book is credited to them.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddSalesRepForm />
        </CardContent>
      </Card>

      {error || !data ? (
        <EmptyState icon={Handshake} title="Couldn't load sales reps" description={error ?? undefined} />
      ) : list.length === 0 ? (
        <EmptyState icon={Handshake} title="No sales reps yet" description="Add your first one above." />
      ) : (
        list.map(({ rep, rows, totals }) => {
          const rate = ratePercent(Number(rep.commission_rate))
          return (
            <Card key={rep.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/employees/sales/${rep.id}`} className="underline-offset-4 hover:underline">
                      {rep.name}
                    </Link>
                    <Badge variant="outline">{rate}</Badge>
                    {rep.removed_at ? <Badge variant="warning">Removed</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {totals.leads} job{totals.leads === 1 ? "" : "s"} sold · {totals.completed} done · {usd(totals.paid)} paid ·{" "}
                    <span className="font-semibold text-ink">{usd(totals.owed)} owed</span>
                  </CardDescription>
                </div>
                <PayAllOwedButton repId={rep.id} owed={totals.owed} name={rep.name} />
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <RepJobsTable rows={rows} ratePercent={rate} />
              </CardContent>
            </Card>
          )
        })
      )}

      {data && data.removed.length > 0 ? (
        <div className="text-sm">
          <Link
            href={showRemoved ? "/admin/employees/sales" : "/admin/employees/sales?removed=1"}
            className="text-ink-muted underline-offset-4 hover:underline"
          >
            {showRemoved ? "Hide removed" : `Show removed (${data.removed.length})`}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
