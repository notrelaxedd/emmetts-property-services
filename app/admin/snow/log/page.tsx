import Link from "next/link"
import { loadSnowRows } from "@/components/admin/snow/load"
import { DeletePushButton } from "@/components/admin/snow/snow-client"
import { SnowTabs } from "@/components/admin/snow/snow-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { SnowPush } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { PLAN_LABEL, planPriceLabel } from "@/lib/snow/billing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Push log" }

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export default async function SnowLogPage() {
  await requireOwner()
  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadSnowRows>> | null = null
  let recent: SnowPush[] = []
  try {
    const db = requireSupabaseAdmin()
    data = await loadSnowRows(db)
    recent = (check(await db.from("snow_pushes").select("*").order("pushed_at", { ascending: false }).limit(100), "pushes") ?? []) as SnowPush[]
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const rows = data?.rows ?? []
  const name = new Map(rows.map((r) => [r.sc.id, r.customer.name]))
  const billed = rows.filter((r) => r.monthCharge > 0 || r.monthPushes > 0)
  const total = billed.reduce((a, r) => a + r.monthCharge, 0)

  return (
    <div className="space-y-4">
      <PageHeader title="Push log" description="What each customer owes this month, and every push logged." />
      <SnowTabs active="log" />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">This month</CardTitle>
          <CardDescription>Monthly plans bill their plan price; per-push customers bill each push. Total {usd(total)}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Pushes</TableHead>
                <TableHead className="text-right">Winter</TableHead>
                <TableHead className="text-right">Owes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .filter((r) => r.sc.active || r.monthPushes)
                .map((r) => (
                  <TableRow key={r.sc.id}>
                    <TableCell>
                      <Link href={`/admin/snow/${r.sc.id}`} className="font-medium hover:underline">
                        {r.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-muted">
                      {PLAN_LABEL[r.sc.plan]} · {data ? planPriceLabel(r.sc, data.settings) : ""}
                      {r.over ? <span className="ml-1 text-amber-700">({r.over} over)</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.monthPushes}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.seasonPushes}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{usd(r.monthCharge)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent pushes</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length ? (
            <ul className="divide-y divide-ink/10">
              {recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">
                    <Link href={`/admin/snow/${p.snow_customer_id}`} className="font-medium text-ink hover:underline">
                      {name.get(p.snow_customer_id) ?? "Customer"}
                    </Link>{" "}
                    <span className="text-ink-muted">{when.format(new Date(p.pushed_at))}</span>
                  </span>
                  <span className="flex items-center gap-2 text-ink-muted">
                    {p.price !== null ? <span className="tabular-nums">{usd(Number(p.price))}</span> : null}
                    <DeletePushButton id={p.id} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No pushes logged yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
