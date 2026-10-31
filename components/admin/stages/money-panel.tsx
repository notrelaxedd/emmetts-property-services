import Link from "next/link"
import { Receipt, Wallet } from "lucide-react"
import { round2, sum, summarizeMonth, usd } from "@/app/admin/money/math"
import { calendarDate, dateTime } from "@/components/admin/inbox/format"
import { ExpenseForm, ExpensesTable } from "@/components/admin/money/expenses"
import { PaidJobForm, type PaidJobCustomer } from "@/components/admin/money/paid-job-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Stat } from "@/components/ui/stat"
import type { PaymentMethod } from "@/lib/db/types"
import { PAYMENT_METHOD_LABEL } from "@/lib/ops/payment-methods"
import { check } from "@/lib/ops/types"
import { addDays, localDate, weekStart, zonedToUtc } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { CollectActions } from "./collect-actions"
import { stageHref } from "./stages"

type QuoteRow = {
  id: string
  customer_id: string
  price_total: number
  fee_total: number
  labor_total: number
  payment_method: PaymentMethod | null
  paid_at: string | null
}
type JobRow = { id: string; quote_id: string | null; customer_id: string; status: string; start_at: string | null; completed_at: string | null }

async function load(today: string) {
  const db = requireSupabaseAdmin()
  const monday = weekStart(today)
  const fromIso = zonedToUtc(monday, "00:00").toISOString()
  const toIso = zonedToUtc(addDays(monday, 7), "00:00").toISOString()
  const quoteCols = "id,customer_id,price_total,fee_total,labor_total,payment_method,paid_at"
  const jobCols = "id,quote_id,customer_id,status,start_at,completed_at"

  const [paid, doneUnpaid, completed, owed, expenses, customerList] = await Promise.all([
    db.from("quotes").select(quoteCols).gte("paid_at", fromIso).lt("paid_at", toIso).order("paid_at", { ascending: false }),
    db.from("jobs").select(jobCols).eq("status", "done").eq("paid", false).order("completed_at", { ascending: false }).limit(200),
    db.from("jobs").select(jobCols).eq("status", "done").gte("completed_at", fromIso).lt("completed_at", toIso),
    db.from("payouts").select("amount").is("paid_cash_at", null),
    db.from("expenses").select("id,date,category,amount,note").gte("date", monday).lt("date", addDays(monday, 7)).order("date", { ascending: false }),
    db.from("customers").select("id,name,address").order("name", { ascending: true }).limit(2000),
  ])
  const paidRows = (check(paid, "paid this week") ?? []) as QuoteRow[]
  const doneRows = (check(doneUnpaid, "done unpaid") ?? []) as JobRow[]
  const completedRows = (check(completed, "done this week") ?? []) as JobRow[]
  const expenseRows = (check(expenses, "expenses") ?? []).map((e) => ({ ...e, amount: Number(e.amount) }))

  // To collect: a done job whose quote the customer confirmed (accepted) and hasn't paid yet.
  const unpaidQuoteIds = Array.from(new Set(doneRows.map((j) => j.quote_id).filter((q): q is string => !!q)))
  const extraQuoteIds = completedRows.map((j) => j.quote_id).filter((q): q is string => !!q && !paidRows.some((p) => p.id === q))
  const lookupIds = Array.from(new Set([...unpaidQuoteIds, ...extraQuoteIds]))
  const [moreQuotes, payouts] = await Promise.all([
    lookupIds.length ? db.from("quotes").select(`${quoteCols},status`).in("id", lookupIds) : Promise.resolve({ data: [], error: null }),
    completedRows.length ? db.from("payouts").select("job_id,amount").in("job_id", completedRows.map((j) => j.id)) : Promise.resolve({ data: [], error: null }),
  ])
  const quoteRows = (check(moreQuotes, "collect quotes") ?? []) as (QuoteRow & { status: string })[]
  const quoteById = new Map(quoteRows.map((q) => [q.id, q]))
  const seen = new Set<string>()
  const toCollect = doneRows
    .map((j) => ({ job: j, quote: j.quote_id ? quoteById.get(j.quote_id) : undefined }))
    .filter((r): r is { job: JobRow; quote: QuoteRow & { status: string } } => {
      if (!r.quote || r.quote.status !== "accepted" || r.quote.paid_at || seen.has(r.quote.id)) return false
      seen.add(r.quote.id)
      return true
    })

  const custIds = Array.from(new Set([...paidRows.map((q) => q.customer_id), ...toCollect.map((r) => r.quote.customer_id)]))
  const customers = custIds.length ? check(await db.from("customers").select("id,name,email").in("id", custIds), "money customers") ?? [] : []
  const customer = new Map(customers.map((c) => [c.id, c]))

  // Kept this week: what came in minus card fees, crew pay for the jobs done this week and expenses.
  const nums = (q: QuoteRow) => ({ ...q, price_total: Number(q.price_total), fee_total: Number(q.fee_total), labor_total: Number(q.labor_total) })
  const quotesById = new Map([...paidRows, ...quoteRows].map((q) => [q.id, nums(q)]))
  const summary = summarizeMonth({
    acceptedQuotes: paidRows.map((q) => ({ ...nums(q), accepted_at: q.paid_at })),
    completedJobs: completedRows.map((j) => ({ ...j, customer_name: "" })),
    payouts: ((check(payouts, "payouts") ?? []) as { job_id: string; amount: number }[]).map((p) => ({ job_id: p.job_id, amount: Number(p.amount) })),
    quotesById,
    expenses: expenseRows,
    aiSpend: 0,
  })

  return {
    monday,
    collected: summary.revenue,
    kept: summary.profit,
    crewOwed: sum((check(owed, "crew owed") ?? []) as { amount: number }[], (p) => p.amount),
    toCollect: toCollect.map(({ job, quote }) => ({
      quoteId: quote.id,
      name: customer.get(quote.customer_id)?.name ?? "Customer",
      email: customer.get(quote.customer_id)?.email ?? null,
      amount: Number(quote.price_total),
      method: quote.payment_method,
      doneAt: job.completed_at,
    })),
    paid: paidRows.map((q) => ({
      id: q.id,
      name: customer.get(q.customer_id)?.name ?? "Customer",
      amount: Number(q.price_total),
      method: q.payment_method,
      paidAt: q.paid_at,
    })),
    expenses: expenseRows,
    customers: (check(customerList, "customers") ?? []) as PaidJobCustomer[],
  }
}

/**
 * The front page's Money stage: this week's numbers, who to collect from (cash / check / card link),
 * what came in, plus expenses and "Add a paid job". Payment is always collected after the job.
 */
export async function MoneyPanel() {
  const today = localDate(new Date())
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(today)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (error || !data) return <EmptyState icon={Wallet} title="Couldn't load the numbers" description={error ?? undefined} />
  const toCollectTotal = round2(data.toCollect.reduce((a, r) => a + r.amount, 0))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected this week" value={usd(data.collected)} hint={`since Mon ${calendarDate(data.monday).split(", ")[1] ?? ""}`} />
        <Stat label="To collect" value={usd(toCollectTotal)} hint={`${data.toCollect.length} done job${data.toCollect.length === 1 ? "" : "s"}`} />
        <Link href="/admin/employees" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Stat label="Crew owed" value={usd(data.crewOwed)} hint="cash payouts not paid yet" className="h-full hover:bg-paper" />
        </Link>
        <Stat label="Kept" value={usd(data.kept)} deltaTone={data.kept >= 0 ? "up" : "down"} hint="this week, after fees, crew pay and expenses" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">To collect</CardTitle>
          <CardDescription>Done jobs not paid yet. Record cash or a check, or email a card link.</CardDescription>
        </CardHeader>
        <CardContent className={data.toCollect.length ? "p-0 pb-2" : undefined}>
          {data.toCollect.length ? (
            <ul className="divide-y divide-ink/10">
              {data.toCollect.map((r) => (
                <li key={r.quoteId} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={stageHref("quotes", { id: r.quoteId })} scroll={false} className="font-semibold text-ink underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                      <span className="font-semibold tabular-nums text-ink">{usd(r.amount)}</span>
                      {r.method ? <Badge variant="outline">Said {PAYMENT_METHOD_LABEL[r.method].toLowerCase()}</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-muted">Done {dateTime(r.doneAt)}</p>
                  </div>
                  <CollectActions quoteId={r.quoteId} customerName={r.name} amount={r.amount} email={r.email} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Nothing to collect. Every finished job is paid.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paid this week</CardTitle>
        </CardHeader>
        <CardContent className={data.paid.length ? "p-0 pb-2" : undefined}>
          {data.paid.length ? (
            <ul className="divide-y divide-ink/10">
              {data.paid.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {dateTime(p.paidAt)}
                      {p.method ? ` · ${PAYMENT_METHOD_LABEL[p.method].toLowerCase()}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{usd(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Receipt} title="Nothing paid yet this week" description="Payments land here when you record them or a card link is paid." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a paid job</CardTitle>
          <CardDescription>A job that&rsquo;s already done and paid. It counts on the day you pick.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaidJobForm today={today} customers={data.customers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expenses</CardTitle>
          <CardDescription>Fuel, equipment, supplies, ads and anything else. This week&rsquo;s are below; the full month is on the Money page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ExpenseForm defaultDate={today} />
          {data.expenses.length ? (
            <div className="-mx-4">
              <ExpensesTable rows={data.expenses} />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No expenses logged this week.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
