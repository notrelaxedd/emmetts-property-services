import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Phone } from "lucide-react"
import { loadMowSettings } from "@/components/admin/mowing/load"
import { CutButton, DeleteCutButton, MowPlanForm } from "@/components/admin/mowing/mowing-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { MowCut } from "@/lib/db/types"
import { FREQUENCY_LABEL } from "@/lib/mowing/schedule"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Mowing customer" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" })

export default async function MowCustomerPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!UUID.test(params.id)) notFound()
  const db = requireSupabaseAdmin()
  const mc = check(await db.from("mow_customers").select("*").eq("id", params.id).maybeSingle(), "mow customer")
  if (!mc) notFound()
  const [customer, cuts, settings] = await Promise.all([
    db.from("customers").select("id,name,address,phone,lat").eq("id", mc.customer_id).single(),
    db.from("mow_cuts").select("*").eq("mow_customer_id", mc.id).order("cut_at", { ascending: false }).limit(500),
    loadMowSettings(db),
  ])
  const c = check(customer, "customer")
  if (!c) notFound()
  const log = (check(cuts, "cuts") ?? []) as MowCut[]
  const months = new Map<string, MowCut[]>()
  for (const cut of log) {
    const key = localDate(new Date(cut.cut_at)).slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), cut])
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/mowing">
          <ArrowLeft aria-hidden="true" /> Mowing
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={`${FREQUENCY_LABEL[mc.frequency]} · ${usd(Number(mc.price))}/cut · ${mc.est_minutes ?? settings.default_minutes} min`}
        actions={<CutButton id={mc.id} name={c.name} />}
      />
      {c.lat === null ? (
        <p className="rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950">
          This address isn&apos;t on the map yet, so they&apos;re left off the route. Check the address below and save.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Schedule & price</CardTitle>
            {c.phone ? (
              <CardDescription>
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 underline">
                  <Phone className="size-3.5" aria-hidden="true" /> {c.phone}
                </a>
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <MowPlanForm
              id={mc.id}
              settings={settings}
              initial={{
                frequency: mc.frequency,
                price: Number(mc.price),
                est_minutes: mc.est_minutes,
                preferred_day: mc.preferred_day,
                anchor_date: mc.anchor_date,
                notes: mc.notes,
                active: mc.active,
                address: c.address ?? "",
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cut log</CardTitle>
            <CardDescription>Every cut, by month. Remove one if it was logged by mistake.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {months.size === 0 ? <p className="text-sm text-ink-muted">No cuts yet.</p> : null}
            {Array.from(months.entries()).map(([key, list]) => (
              <section key={key} className="space-y-1">
                <h3 className="flex items-baseline justify-between text-sm font-semibold text-ink">
                  <span>
                    {monthName.format(new Date(`${key}-01T12:00:00Z`))} · {list.length} cut{list.length === 1 ? "" : "s"}
                  </span>
                  <span className="tabular-nums">{usd(list.reduce((a, x) => a + Number(x.price), 0))}</span>
                </h3>
                <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
                  {list.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                      <span>{when.format(new Date(x.cut_at))}</span>
                      <span className="flex items-center gap-2 text-ink-muted">
                        <span className="tabular-nums">{usd(Number(x.price))}</span>
                        <DeleteCutButton id={x.id} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
