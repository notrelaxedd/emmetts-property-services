import Link from "next/link"
import { MapPinOff, Snowflake } from "lucide-react"
import { loadSnowRows } from "@/components/admin/snow/load"
import { AddSnowCustomerForm, PushButton } from "@/components/admin/snow/snow-client"
import { SnowTabs } from "@/components/admin/snow/snow-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops/types"
import { planPriceLabel } from "@/lib/snow/billing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Snow" }

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export default async function SnowPage() {
  await requireOwner()
  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadSnowRows>> | null = null
  let existing: { id: string; name: string; snow: boolean }[] = []
  try {
    const db = requireSupabaseAdmin()
    data = await loadSnowRows(db)
    const onPlan = new Set(data.rows.map((r) => r.customer.id))
    const all = check(await db.from("customers").select("id,name,snow_list").order("name").limit(500), "customers") ?? []
    existing = all
      .filter((c) => !onPlan.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, snow: c.snow_list }))
      .sort((a, b) => Number(b.snow) - Number(a.snow) || a.name.localeCompare(b.name))
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const rows = data?.rows ?? []
  const active = rows.filter((r) => r.sc.active)
  const monthTotal = active.reduce((a, r) => a + r.monthCharge, 0)
  const pushesMonth = rows.reduce((a, r) => a + r.monthPushes, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Snow removal"
        description={`${active.length} active · ${pushesMonth} push${pushesMonth === 1 ? "" : "es"} this month · ${usd(monthTotal)} billed this month`}
      />
      <SnowTabs active="customers" />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load snow: {error}</AlertDescription>
        </Alert>
      ) : null}
      {data && rows.length ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink/10">
            {rows.map((r) => (
              <li
                key={r.sc.id}
                className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !r.sc.active && "opacity-60")}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/snow/${r.sc.id}`} className="font-semibold text-ink hover:underline">
                      {r.customer.name}
                    </Link>
                    <Badge variant="outline">{planPriceLabel(r.sc, data.settings)}</Badge>
                    {!r.sc.active ? <Badge variant="outline">Paused</Badge> : null}
                  </p>
                  <p className="flex items-center gap-1 truncate text-sm text-ink-body">
                    {r.customer.lat === null ? <MapPinOff className="size-3.5 shrink-0 text-amber-600" aria-label="Not on the map" /> : null}
                    {r.customer.address ?? "No address"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    <span className="font-semibold text-ink">{r.monthPushes}</span> push{r.monthPushes === 1 ? "" : "es"} this month ·{" "}
                    {r.seasonPushes} this winter · {usd(r.monthCharge)} this month
                    {r.lastPush ? ` · last ${when.format(new Date(r.lastPush))}` : ""}
                  </p>
                </div>
                <PushButton id={r.sc.id} name={r.customer.name} />
              </li>
            ))}
          </ul>
        </Card>
      ) : data ? (
        <EmptyState icon={Snowflake} title="No snow customers yet" description="Add your first one below." />
      ) : null}
      {data ? <AddSnowCustomerForm settings={data.settings} existing={existing} /> : null}
    </div>
  )
}
