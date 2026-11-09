import Link from "next/link"
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react"
import { loadSnowBills, nextMonth, prevMonth } from "@/components/admin/snow/load"
import { SendBill } from "@/components/admin/billing/send-bill"
import { BillControls } from "@/components/admin/snow/snow-client"
import { SnowTabs } from "@/components/admin/snow/snow-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { localDate } from "@/lib/scheduler/time"
import { planPriceLabel } from "@/lib/snow/billing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Snow bills" }

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`
const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" })
const METHOD_LABEL = { cash: "Cash", card: "Card", check: "Check" } as const

export default async function SnowBillsPage({ searchParams }: { searchParams: { month?: string } }) {
  await requireOwner()
  const today = localDate(new Date())
  // Early in the month you're billing the month that just ended.
  const fallback = Number(today.slice(8, 10)) <= 7 ? prevMonth(`${today.slice(0, 7)}-01`) : `${today.slice(0, 7)}-01`
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? `${searchParams.month}-01` : fallback
  const ended = nextMonth(month) <= today

  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadSnowBills>> | null = null
  try {
    data = await loadSnowBills(requireSupabaseAdmin(), month)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const rows = data?.rows ?? []
  const total = rows.reduce((a, r) => a + r.amount, 0)
  const paid = rows.filter((r) => r.paidAt).reduce((a, r) => a + r.amount, 0)
  const byMethod = (["cash", "card", "check"] as const).map((m) => ({
    m,
    total: rows.filter((r) => r.payMethod === m).reduce((a, r) => a + r.amount, 0),
  }))
  const noMethod = rows.filter((r) => !r.payMethod && r.amount > 0).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Snow bills"
        description={`${monthName.format(new Date(`${month}T12:00:00Z`))}${ended ? "" : " (month still going: totals can still change)"}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/snow/bills?month=${prevMonth(month).slice(0, 7)}`} aria-label="Previous month">
                <ChevronLeft /> Prev
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/snow/bills?month=${nextMonth(month).slice(0, 7)}`} aria-label="Next month">
                Next <ChevronRight />
              </Link>
            </Button>
          </>
        }
      />
      <SnowTabs active="bills" />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load bills: {error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Total billed</p>
            <p className="text-3xl font-bold tabular-nums text-ink">{usd(total)}</p>
            <p className="text-xs text-ink-muted">
              {byMethod
                .filter((b) => b.total > 0)
                .map((b) => `${METHOD_LABEL[b.m]} ${usd(b.total)}`)
                .join(" · ") || "No pay method set yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Paid</p>
            <p className="text-3xl font-bold tabular-nums text-brand-green-dark">{usd(paid)}</p>
            <p className="text-xs text-ink-muted">
              {rows.filter((r) => r.paidAt).length} of {rows.length} customers
            </p>
          </CardContent>
        </Card>
        <Card className={total - paid > 0 ? "border-amber-400" : undefined}>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Still owed</p>
            <p className="text-3xl font-bold tabular-nums text-ink">{usd(total - paid)}</p>
            <p className="text-xs text-ink-muted">{noMethod ? `${noMethod} with no pay method yet` : " "}</p>
          </CardContent>
        </Card>
      </div>

      {data && rows.length ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink/10">
            {rows.map((r) => (
              <li
                key={r.sc.id}
                className={cn("grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center lg:gap-6", r.paidAt && "bg-brand-green/5")}
              >
                <div className="min-w-0">
                  <Link href={`/admin/snow/${r.sc.id}`} className="font-semibold text-ink hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {planPriceLabel(r.sc, data.settings)} · {r.pushes} push{r.pushes === 1 ? "" : "es"}
                  </p>
                </div>
                <p className="text-xl font-bold tabular-nums text-ink lg:text-right">{usd(r.amount)}</p>
                <BillControls id={r.sc.id} month={month} name={r.name} payMethod={r.payMethod} paid={!!r.paidAt} />
                {r.paidAt || r.amount <= 0 ? (
                  <span />
                ) : (
                  <SendBill
                    phone={r.phone}
                    email={r.email}
                    bill={{
                      customerName: r.name,
                      service: "snow removal",
                      monthLabel: monthName.format(new Date(`${month}T12:00:00Z`)),
                      count: r.pushes,
                      unit: "push",
                      amount: r.amount,
                      payMethod: r.payMethod,
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : data ? (
        <EmptyState icon={Receipt} title="No bills this month" description="Active snow customers and anyone with pushes show up here." />
      ) : null}
    </div>
  )
}
