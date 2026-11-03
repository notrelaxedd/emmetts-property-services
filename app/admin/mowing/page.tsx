import Link from "next/link"
import { MapPinOff, Sprout } from "lucide-react"
import { loadMowRows } from "@/components/admin/mowing/load"
import { AddMowCustomerForm, CutButton } from "@/components/admin/mowing/mowing-client"
import { MowingTabs } from "@/components/admin/mowing/mowing-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { FREQUENCY_LABEL, WEEKDAYS } from "@/lib/mowing/schedule"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Mowing" }

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`
const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })
const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
const fmt = (d: string | null) => (d ? day.format(new Date(`${d}T12:00:00Z`)) : null)

export default async function MowingPage() {
  await requireOwner()
  const today = localDate(new Date())
  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadMowRows>> | null = null
  let existing: { id: string; name: string }[] = []
  try {
    const db = requireSupabaseAdmin()
    data = await loadMowRows(db, today)
    const on = new Set(data.rows.map((r) => r.customer.id))
    existing = ((check(await db.from("customers").select("id,name").order("name").limit(500), "customers") ?? []) as { id: string; name: string }[]).filter(
      (c) => !on.has(c.id),
    )
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const rows = data?.rows ?? []
  const active = rows.filter((r) => r.mc.active)
  const dueLeft = active.filter((r) => r.dueWeek && !r.cutWeek).length
  const weekly = active.reduce((a, r) => a + (r.mc.frequency === "weekly" ? Number(r.mc.price) : Number(r.mc.price) / 2), 0)
  const monthTotal = rows.reduce((a, r) => a + r.monthTotal, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mowing"
        description={`${active.length} lawns · ${dueLeft} still to cut this week · about ${usd(weekly)}/week · ${usd(monthTotal)} cut this month`}
      />
      <MowingTabs active="customers" />
      {data ? (
        <p className={data.inSeason ? "text-sm text-ink-muted" : "rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950"}>
          {data.inSeason ? "Season: " : "Off season. Nothing is due until the season starts. Season: "}
          {fmt(data.settings.season_start) ?? "open"} – {fmt(data.settings.season_end) ?? "open"}{" "}
          <Link href="/admin/mowing/settings" className="underline">
            Change
          </Link>
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load mowing: {error}</AlertDescription>
        </Alert>
      ) : null}
      {data && rows.length ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink/10">
            {rows.map((r) => (
              <li key={r.mc.id} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !r.mc.active && "opacity-60")}>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/mowing/${r.mc.id}`} className="font-semibold text-ink hover:underline">
                      {r.customer.name}
                    </Link>
                    <Badge variant="secondary">
                      {FREQUENCY_LABEL[r.mc.frequency]} · {usd(Number(r.mc.price))}/cut
                    </Badge>
                    {!r.mc.active ? <Badge variant="outline">Paused</Badge> : null}
                    {r.mc.active && r.cutWeek ? <Badge variant="success">Cut this week</Badge> : null}
                    {r.mc.active && r.dueWeek && !r.cutWeek ? <Badge variant="warning">Due this week</Badge> : null}
                    {r.mc.active && !r.dueWeek && data.inSeason ? <Badge variant="outline">Off week</Badge> : null}
                    {r.mc.active && !data.inSeason ? <Badge variant="outline">Off season</Badge> : null}
                  </p>
                  <p className="flex items-center gap-1 truncate text-sm text-ink-body">
                    {r.customer.lat === null ? <MapPinOff className="size-3.5 shrink-0 text-amber-600" aria-label="Not on the map" /> : null}
                    {r.customer.address ?? "No address"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {r.mc.est_minutes ?? data.settings.default_minutes} min
                    {r.mc.preferred_day !== null ? ` · ${WEEKDAYS[r.mc.preferred_day]}s` : ""} · {r.monthCuts} cut{r.monthCuts === 1 ? "" : "s"} this month (
                    {usd(r.monthTotal)}) · {r.seasonCuts} this season{r.lastCut ? ` · last ${when.format(new Date(r.lastCut))}` : ""}
                  </p>
                </div>
                <CutButton id={r.mc.id} name={r.customer.name} />
              </li>
            ))}
          </ul>
        </Card>
      ) : data ? (
        <EmptyState icon={Sprout} title="No mowing customers yet" description="Add your first one below." />
      ) : null}
      {data ? <AddMowCustomerForm settings={data.settings} existing={existing} today={today} /> : null}
    </div>
  )
}
