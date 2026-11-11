import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Handshake } from "lucide-react"
import { SalesRepSettings } from "@/components/admin/sales/rep-forms"
import { PayAllOwedButton, RepJobsTable } from "@/components/admin/sales/rep-jobs"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { loadCommissions } from "@/lib/commissions/load"
import { ratePercent, repTotals } from "@/lib/commissions/stats"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sales rep" }

async function load(id: string) {
  const { reps, rows } = await loadCommissions(requireSupabaseAdmin(), id)
  const rep = reps[0]
  if (!rep) return null
  return { rep, rows, totals: repTotals(rows) }
}

export default async function SalesRepPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound()
  let data: Awaited<ReturnType<typeof load>> = null
  let error: string | null = null
  try {
    data = await load(params.id)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (!error && !data) notFound()

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href="/admin/employees/sales">
        <ArrowLeft /> Sales reps
      </Link>
    </Button>
  )
  if (error || !data) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={Handshake} title="Couldn't load this sales rep" description={error ?? undefined} />
      </div>
    )
  }

  const { rep, rows, totals } = data
  const rateNum = Number(rep.commission_rate)
  const rate = ratePercent(rateNum)

  return (
    <div className="space-y-5">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {rep.name}
            <Badge variant="outline">{rate} commission</Badge>
            {rep.removed_at ? <Badge variant="warning">Removed</Badge> : null}
          </span>
        }
        description={rep.phone ?? undefined}
        actions={<PayAllOwedButton repId={rep.id} owed={totals.owed} name={rep.name} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Jobs sold" value={totals.leads.toLocaleString()} />
        <Stat label="Jobs done" value={totals.completed.toLocaleString()} />
        <Stat label="Earned" value={usd(totals.earned)} hint={`${rate} of ${usd(totals.sold)}`} />
        <Stat label="Paid out" value={usd(totals.paid)} />
        <Stat label="Owed now" value={usd(totals.owed)} hint={totals.pending > 0 ? `${usd(totals.pending)} more once jobs are done` : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <RepJobsTable rows={rows} ratePercent={rate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesRepSettings
            rep={{ id: rep.id, name: rep.name, phone: rep.phone, ratePercent: Math.round(rateNum * 1000) / 10, removed: rep.removed_at !== null }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
