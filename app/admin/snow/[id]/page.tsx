import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Phone } from "lucide-react"
import { loadSnowSettings } from "@/components/admin/snow/load"
import { DeletePushButton, PushButton, SnowPlanForm } from "@/components/admin/snow/snow-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { SnowPush } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { monthCharge, PLAN_LABEL, planPriceLabel, seasonStart } from "@/lib/snow/billing"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Snow customer" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" })

export default async function SnowCustomerPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!UUID.test(params.id)) notFound()
  const db = requireSupabaseAdmin()
  const sc = check(await db.from("snow_customers").select("*").eq("id", params.id).maybeSingle(), "snow customer")
  if (!sc) notFound()
  const [customer, pushes, settings] = await Promise.all([
    db.from("customers").select("id,name,address,phone,lat").eq("id", sc.customer_id).single(),
    db.from("snow_pushes").select("*").eq("snow_customer_id", sc.id).order("pushed_at", { ascending: false }).limit(500),
    loadSnowSettings(db),
  ])
  const c = check(customer, "customer")
  if (!c) notFound()
  const log = (check(pushes, "pushes") ?? []) as SnowPush[]

  // Group the log by month (local), newest first, with what each month comes to.
  const months = new Map<string, SnowPush[]>()
  for (const p of log) {
    const key = localDate(new Date(p.pushed_at)).slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), p])
  }
  const season = seasonStart(localDate(new Date()))
  const seasonCount = log.filter((p) => localDate(new Date(p.pushed_at)) >= season).length

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/snow">
          <ArrowLeft aria-hidden="true" /> Snow
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={`${PLAN_LABEL[sc.plan]} · ${planPriceLabel(sc, settings)} · ${seasonCount} push${seasonCount === 1 ? "" : "es"} this winter`}
        actions={<PushButton id={sc.id} name={c.name} />}
      />
      {c.lat === null ? (
        <p className="rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950">
          This address isn&apos;t on the map yet, so they&apos;re left off the route. Check the address below and save.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Plan</CardTitle>
            {c.phone ? (
              <CardDescription>
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 underline">
                  <Phone className="size-3.5" aria-hidden="true" /> {c.phone}
                </a>
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <SnowPlanForm
              id={sc.id}
              settings={settings}
              initial={{
                plan: sc.plan,
                per_push_price: sc.per_push_price === null ? null : Number(sc.per_push_price),
                est_minutes: sc.est_minutes,
                notes: sc.notes,
                active: sc.active,
                address: c.address ?? "",
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Push log</CardTitle>
            <CardDescription>Every push, by month. Remove one if it was pressed by mistake.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {months.size === 0 ? <p className="text-sm text-ink-muted">No pushes yet.</p> : null}
            {Array.from(months.entries()).map(([key, list]) => {
              const charge = monthCharge(sc, settings, list)
              return (
                <section key={key} className="space-y-1">
                  <h3 className="flex items-baseline justify-between text-sm font-semibold text-ink">
                    <span>
                      {monthName.format(new Date(`${key}-01T12:00:00Z`))} · {list.length} push{list.length === 1 ? "" : "es"}
                    </span>
                    <span className="tabular-nums">
                      {usd(charge.amount)}
                      {charge.over ? <span className="ml-1 text-xs font-normal text-amber-700">({charge.over} over plan)</span> : null}
                    </span>
                  </h3>
                  <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
                    {list.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                        <span>{when.format(new Date(p.pushed_at))}</span>
                        <span className="flex items-center gap-2 text-ink-muted">
                          {p.price !== null ? <span className="tabular-nums">{usd(Number(p.price))}</span> : null}
                          <DeletePushButton id={p.id} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
