import Link from "next/link"
import { Map as MapIcon, MapPinOff, Truck } from "lucide-react"
import { loadMowRoutePlan } from "@/components/admin/mowing/load"
import { CutButton, DeleteMowRouteButton, MowRouteControls } from "@/components/admin/mowing/mowing-client"
import { MowingTabs } from "@/components/admin/mowing/mowing-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { MowRoute } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { addDays, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Mowing route" }

const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })
const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" })
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`)
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`

export default async function MowRoutePage({ searchParams }: { searchParams: { date?: string; trucks?: string } }) {
  await requireOwner()
  const today = localDate(new Date())
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "") ? searchParams.date! : today
  const trucks = Math.min(5, Math.max(1, Number.parseInt(searchParams.trucks ?? "1", 10) || 1))

  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadMowRoutePlan>> | null = null
  let saved: MowRoute[] = []
  try {
    const db = requireSupabaseAdmin()
    data = await loadMowRoutePlan(db, date, trucks)
    saved = (check(await db.from("mow_routes").select("*").gte("run_date", addDays(today, -14)).order("run_date", { ascending: false }).limit(20), "mow routes") ??
      []) as MowRoute[]
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const plan = data?.plan
  const byId = new Map((data?.rows ?? []).map((r) => [r.mc.id, r]))
  const stopCount = plan?.trucks.reduce((a, t) => a + t.stops.length, 0) ?? 0
  const dayTotal = (data?.due ?? []).reduce((a, r) => a + Number(r.mc.price), 0)
  const cutAlready = (data?.rows ?? []).filter((r) => r.mc.active && r.dueWeek && r.cutWeek).length

  return (
    <div className="space-y-4">
      <PageHeader title="Mowing route" description="The lawns due that day, in the best order from the shop." />
      <MowingTabs active="route" />
      <MowRouteControls date={date} trucks={trucks} canSave={!!plan?.startAt} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t plan the route: {error}</AlertDescription>
        </Alert>
      ) : null}

      {plan?.startAt ? (
        <Card className="border-brand-green-dark bg-brand-green/10">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Start</p>
              <p className="text-3xl font-bold tabular-nums text-ink">{time.format(plan.startAt)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Done about</p>
              <p className="text-3xl font-bold tabular-nums text-ink">{time.format(plan.finishBy)}</p>
            </div>
            <p className="text-sm text-ink-body">
              {day.format(new Date(`${date}T12:00:00Z`))} · {stopCount} lawn{stopCount === 1 ? "" : "s"} · {usd(dayTotal)}
              {cutAlready ? ` · ${cutAlready} already cut this week` : ""}
            </p>
          </CardContent>
        </Card>
      ) : data && !error ? (
        <EmptyState
          icon={Truck}
          title={data.inSeason ? "No lawns due that day" : "That day is outside the mowing season"}
          description={
            data.inSeason
              ? "Lawns show up on their mow day (or any day if none is set) in a week they're due and not cut yet."
              : "Change the season dates in Mowing settings if you're still cutting."
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plan?.trucks.map((t) => (
          <Card key={t.truck}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="size-4 text-brand-green-dark" aria-hidden="true" />
                {plan.trucks.length > 1 ? `Crew ${t.truck}` : "Route"}: {time.format(t.startAt)}–{time.format(t.finishAt)}
              </CardTitle>
              <CardDescription>
                {t.stops.length} lawns · {dur(t.workMinutes)} mowing · {dur(t.driveMinutes)} driving
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                {t.mapsUrls.map((u, i) => (
                  <Button key={u} asChild size="sm" variant="outline">
                    <a href={u} target="_blank" rel="noopener noreferrer">
                      <MapIcon aria-hidden="true" /> {t.mapsUrls.length > 1 ? `Directions ${i + 1}/${t.mapsUrls.length}` : "Open in Google Maps"}
                    </a>
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <ol className="divide-y divide-ink/10">
                {t.stops.map((s, i) => {
                  const r = byId.get(s.id)
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline justify-between gap-2">
                          <Link href={`/admin/mowing/${s.id}`} className="truncate font-semibold text-ink hover:underline">
                            {s.name}
                          </Link>
                          <span className="shrink-0 text-sm tabular-nums text-ink">{time.format(s.arriveAt)}</span>
                        </p>
                        <p className="truncate text-xs text-ink-muted">
                          {s.address ?? ""} · {s.driveMinutes}m drive · {s.minutes}m mow{r ? ` · ${usd(Number(r.mc.price))}` : ""}
                          {r?.mc.notes ? ` · ${r.mc.notes}` : ""}
                        </p>
                      </div>
                      <CutButton id={s.id} name={s.name} size="sm" />
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>

      {plan?.unrouted.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinOff className="size-4 text-amber-600" aria-hidden="true" /> Due but not on the map
            </CardTitle>
            <CardDescription>Fix the address to put them in the route.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {plan.unrouted.map((s) => (
                <li key={s.id}>
                  <Link href={`/admin/mowing/${s.id}`} className="font-medium text-ink underline">
                    {s.name}
                  </Link>{" "}
                  <span className="text-ink-muted">{s.address ?? "no address"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {saved.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Saved routes</CardTitle>
            <CardDescription>These show on the Jobs calendar for their day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-ink/10">
              {saved.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/mowing/route?date=${r.run_date}&trucks=${r.trucks}`} className="font-medium text-ink hover:underline">
                    {day.format(new Date(`${r.run_date}T12:00:00Z`))}: {time.format(new Date(r.start_at))}–{time.format(new Date(r.finish_at))} · {r.stops.length} lawns
                  </Link>
                  <DeleteMowRouteButton id={r.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
