import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Wallet } from "lucide-react"
import { MarkAllPaidButton, PayoutsTable, type PayoutRow } from "@/components/admin/employees/payouts-table"
import { usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Payout log" }

async function load(id: string) {
  const db = requireSupabaseAdmin()
  const profile = await db.from("profiles").select("*").eq("id", id).maybeSingle()
  if (profile.error) throw new Error(profile.error.message)
  if (!profile.data) return null

  const payouts = await db.from("payouts").select("*").eq("crew_id", id).order("created_at", { ascending: false }).limit(500)
  if (payouts.error) throw new Error(payouts.error.message)
  const jobIds = Array.from(new Set((payouts.data ?? []).map((p) => p.job_id)))
  const jobs = jobIds.length
    ? await db.from("jobs").select("id,customer_id,start_at,completed_at").in("id", jobIds)
    : { data: [] as { id: string; customer_id: string; start_at: string | null; completed_at: string | null }[], error: null }
  if (jobs.error) throw new Error(jobs.error.message)
  const custIds = Array.from(new Set((jobs.data ?? []).map((j) => j.customer_id)))
  const customers = custIds.length
    ? await db.from("customers").select("id,name,address").in("id", custIds)
    : { data: [] as { id: string; name: string; address: string | null }[], error: null }
  if (customers.error) throw new Error(customers.error.message)

  const jobById = new Map((jobs.data ?? []).map((j) => [j.id, j]))
  const custById = new Map((customers.data ?? []).map((c) => [c.id, c]))
  const rows: PayoutRow[] = (payouts.data ?? []).map((p) => {
    const job = jobById.get(p.job_id)
    const cust = job ? custById.get(job.customer_id) : undefined
    const when = job?.completed_at ?? job?.start_at ?? p.created_at
    return {
      id: p.id,
      jobLabel: cust ? `${cust.name}${cust.address ? ` · ${cust.address}` : ""}` : "Job",
      date: when ? localDate(new Date(when)) : null,
      hours: Number(p.hours),
      rate: Number(p.rate),
      amount: Number(p.amount),
      paidAt: p.paid_cash_at ? localDate(new Date(p.paid_cash_at)) : null,
    }
  })
  const owed = rows.filter((r) => !r.paidAt).reduce((s, r) => s + r.amount, 0)
  const paid = rows.filter((r) => r.paidAt).reduce((s, r) => s + r.amount, 0)
  const hours = rows.reduce((s, r) => s + r.hours, 0)
  return { profile: profile.data, rows, owed: Math.round(owed * 100) / 100, paid, hours }
}

export default async function EmployeePage({ params }: { params: { id: string } }) {
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

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/employees">
          <ArrowLeft /> Employees
        </Link>
      </Button>
      {error || !data ? (
        <EmptyState icon={Wallet} title="Couldn't load this employee" description={error ?? undefined} />
      ) : (
        <>
          <PageHeader
            title={data.profile.name || "Unnamed"}
            description={[data.profile.phone, data.profile.email, `${usd(Number(data.profile.hourly_rate))}/hr`].filter(Boolean).join(" · ")}
            actions={
              <>
                {data.profile.paused ? <Badge variant="warning">Paused</Badge> : null}
                <MarkAllPaidButton crewId={data.profile.id} owed={data.owed} />
              </>
            }
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Cash owed" value={usd(data.owed)} />
            <Stat label="Paid to date" value={usd(data.paid)} />
            <Stat label="Hours logged" value={`${data.hours.toFixed(1)}h`} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Payout log</CardTitle>
            </CardHeader>
            <CardContent className={data.rows.length ? "p-0 pb-2" : undefined}>
              {data.rows.length ? (
                <PayoutsTable rows={data.rows} />
              ) : (
                <EmptyState icon={Wallet} title="No payouts yet" description="Payouts appear here when this crew member completes a job." />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
