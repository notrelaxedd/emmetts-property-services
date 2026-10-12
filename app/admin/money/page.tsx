import Link from "next/link"
import { ChevronLeft, ChevronRight, Receipt, Wallet } from "lucide-react"
import { ExpenseForm, ExpensesTable } from "@/components/admin/money/expenses"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import { localDate, zonedToUtc } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"
import {
  monthLabel,
  monthRange,
  parseMonth,
  profitPerJob,
  profitPerWeek,
  shiftMonth,
  summarizeMonth,
  sum,
  usd,
  type MoneyJob,
  type MoneyQuote,
} from "./math"

export const dynamic = "force-dynamic"
export const metadata = { title: "Money" }

type QuoteRow = MoneyQuote & { customer_id: string }

async function load(month: string) {
  const db = requireSupabaseAdmin()
  const { from, to } = monthRange(month)
  const fromIso = zonedToUtc(from, "00:00").toISOString()
  const toIso = zonedToUtc(to, "00:00").toISOString()
  const isCurrent = month === localDate(new Date()).slice(0, 7)

  const quoteCols = "id,customer_id,price_total,fee_total,labor_total,accepted_at"
  const jobCols = "id,quote_id,customer_id,status,start_at,completed_at"
  const [accepted, completed, expenses, ai] = await Promise.all([
    db.from("quotes").select(quoteCols).gte("accepted_at", fromIso).lt("accepted_at", toIso),
    db.from("jobs").select(jobCols).eq("status", "done").gte("completed_at", fromIso).lt("completed_at", toIso),
    db.from("expenses").select("id,date,category,amount,note").gte("date", from).lt("date", to).order("date", { ascending: false }),
    isCurrent
      ? db.rpc("ai_spend_this_month")
      : db.from("ai_usage").select("est_cost").gte("created_at", fromIso).lt("created_at", toIso),
  ])
  for (const r of [accepted, completed, expenses]) if (r.error) throw new Error(r.error.message)

  const acceptedQuotes = (accepted.data ?? []) as QuoteRow[]
  const acceptedIds = acceptedQuotes.map((q) => q.id)
  const paidJobs = acceptedIds.length ? await db.from("jobs").select(jobCols).in("quote_id", acceptedIds) : { data: [], error: null }
  if (paidJobs.error) throw new Error(paidJobs.error.message)

  type JobRow = { id: string; quote_id: string | null; customer_id: string; status: string; start_at: string | null; completed_at: string | null }
  const completedRows = (completed.data ?? []) as JobRow[]
  const allJobs = new Map<string, JobRow>()
  for (const j of [...completedRows, ...((paidJobs.data ?? []) as JobRow[])]) allJobs.set(j.id, j)

  const quotesById = new Map<string, QuoteRow>(acceptedQuotes.map((q) => [q.id, q]))
  const missingQuotes = Array.from(new Set(Array.from(allJobs.values()).map((j) => j.quote_id).filter((q): q is string => !!q && !quotesById.has(q))))
  if (missingQuotes.length) {
    const more = await db.from("quotes").select(quoteCols).in("id", missingQuotes)
    if (more.error) throw new Error(more.error.message)
    for (const q of (more.data ?? []) as QuoteRow[]) quotesById.set(q.id, q)
  }

  const jobIds = Array.from(allJobs.keys())
  const custIds = Array.from(new Set([...Array.from(allJobs.values()).map((j) => j.customer_id)]))
  const [payouts, customers] = await Promise.all([
    jobIds.length ? db.from("payouts").select("job_id,amount").in("job_id", jobIds) : Promise.resolve({ data: [], error: null }),
    custIds.length ? db.from("customers").select("id,name").in("id", custIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (payouts.error) throw new Error(payouts.error.message)
  if (customers.error) throw new Error(customers.error.message)
  const custName = new Map(((customers.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const toMoneyJob = (j: JobRow): MoneyJob => ({ ...j, customer_name: custName.get(j.customer_id) ?? "Customer" })
  const payoutRows = ((payouts.data ?? []) as { job_id: string; amount: number }[]).map((p) => ({ job_id: p.job_id, amount: Number(p.amount) }))

  let aiSpend = 0
  if (!ai.error) {
    aiSpend = isCurrent
      ? Number(ai.data ?? 0) || 0
      : sum((ai.data ?? []) as { est_cost: number }[], (r) => r.est_cost)
  }

  const expenseRows = (expenses.data ?? []).map((e) => ({ ...e, amount: Number(e.amount) }))
  const nums = (q: QuoteRow): QuoteRow => ({
    ...q,
    price_total: Number(q.price_total),
    fee_total: Number(q.fee_total),
    labor_total: Number(q.labor_total),
  })
  const quotesNum = new Map(Array.from(quotesById.values()).map((q) => [q.id, nums(q)]))
  const input = {
    acceptedQuotes: acceptedQuotes.map(nums),
    completedJobs: completedRows.map(toMoneyJob),
    payouts: payoutRows,
    quotesById: quotesNum,
    expenses: expenseRows,
  }
  return {
    summary: summarizeMonth({ ...input, aiSpend }),
    weeks: profitPerWeek({ month, ...input }),
    jobs: profitPerJob(Array.from(allJobs.values()).map(toMoneyJob), quotesNum, payoutRows),
    expenses: expenseRows,
    isCurrent,
  }
}

function Money({ n, className }: { n: number; className?: string }) {
  return <span className={cn("tabular-nums", n < 0 && "text-destructive", className)}>{usd(n)}</span>
}

export default async function MoneyPage({ searchParams }: { searchParams: { month?: string } }) {
  await requireOwner()
  const month = parseMonth(searchParams.month)
  const today = localDate(new Date())
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(month)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Money"
        description={monthLabel(month)}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/money?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
                <ChevronLeft /> Prev
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/money">This month</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/money?month=${shiftMonth(month, 1)}`} aria-label="Next month">
                Next <ChevronRight />
              </Link>
            </Button>
          </>
        }
      />
      {error || !data ? (
        <EmptyState icon={Wallet} title="Couldn't load the numbers" description={error ?? undefined} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Stripe revenue" value={usd(data.summary.revenue)} hint="quotes paid this month" />
            <Stat label="Card fees" value={usd(data.summary.fees)} />
            <Stat
              label="Labor"
              value={usd(data.summary.labor)}
              hint={data.summary.laborEstimated ? "includes estimates" : "jobs completed"}
            />
            <Stat label="Expenses" value={usd(data.summary.expenses)} />
            <Stat label={data.isCurrent ? "AI spend this month" : "AI spend"} value={usd(data.summary.aiSpend)} />
            <Stat
              label="Profit"
              value={<Money n={data.summary.profit} />}
              deltaTone={data.summary.profit >= 0 ? "up" : "down"}
              hint="after fees, labor, expenses, AI"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Profit per job</CardTitle>
              <CardDescription>Jobs paid or completed this month. Labor marked “est.” uses the quote until payouts are logged.</CardDescription>
            </CardHeader>
            <CardContent className={data.jobs.length ? "p-0 pb-2" : undefined}>
              {data.jobs.length === 0 ? (
                <EmptyState icon={Receipt} title="No jobs this month" description="Paid and completed jobs show up here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden sm:table-cell">Status</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Fee</TableHead>
                      <TableHead className="text-right">Labor</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.jobs.map((j) => (
                      <TableRow key={j.job_id}>
                        <TableCell className="whitespace-nowrap">{j.date ?? "—"}</TableCell>
                        <TableCell className="font-medium text-ink">{j.customer_name}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline">{j.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right"><Money n={j.price} /></TableCell>
                        <TableCell className="hidden text-right md:table-cell"><Money n={j.fee} /></TableCell>
                        <TableCell className="text-right">
                          <Money n={j.labor} />
                          {j.laborEstimated && j.labor > 0 ? <span className="ml-1 text-xs text-ink-muted">est.</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold"><Money n={j.profit} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By week</CardTitle>
              <CardDescription>Mon–Sun weeks. AI spend is counted for the month only.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week of</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Fees</TableHead>
                    <TableHead className="text-right">Labor</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Expenses</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.weeks.map((w) => (
                    <TableRow key={w.week}>
                      <TableCell className="whitespace-nowrap">{w.week}</TableCell>
                      <TableCell className="text-right"><Money n={w.revenue} /></TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money n={w.fees} /></TableCell>
                      <TableCell className="text-right"><Money n={w.labor} /></TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money n={w.expenses} /></TableCell>
                      <TableCell className="text-right font-semibold"><Money n={w.profit} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Month</TableCell>
                    <TableCell className="text-right"><Money n={data.summary.revenue} /></TableCell>
                    <TableCell className="hidden text-right sm:table-cell"><Money n={data.summary.fees} /></TableCell>
                    <TableCell className="text-right"><Money n={data.summary.labor} /></TableCell>
                    <TableCell className="hidden text-right sm:table-cell"><Money n={data.summary.expenses} /></TableCell>
                    <TableCell className="text-right font-semibold"><Money n={data.summary.profit + data.summary.aiSpend} /></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>Fuel, equipment, supplies, ads and anything else.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ExpenseForm defaultDate={today.slice(0, 7) === month ? today : `${month}-01`} />
              {data.expenses.length ? (
                <div className="-mx-4">
                  <ExpensesTable rows={data.expenses} />
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No expenses logged for {monthLabel(month)}.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
