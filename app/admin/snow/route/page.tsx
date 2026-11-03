import Link from "next/link"
import { Map as MapIcon, MapPinOff, Truck } from "lucide-react"
import { loadRoutePlan } from "@/components/admin/snow/load"
import { DeleteRouteButton, PushButton, RouteControls } from "@/components/admin/snow/snow-client"
import { SnowTabs } from "@/components/admin/snow/snow-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { SnowRoute } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { addDays, localDate, localTime } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Snow route" }

const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })
const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`)

export default async function SnowRoutePage({ searchParams }: { searchParams: { date?: string; trucks?: string } }) {
  await requireOwner()
  const now = new Date()
  // After noon you're planning tomorrow morning.
  const defaultDate = localTime(now) >= "12:00" ? addDays(localDate(now), 1) : localDate(now)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "") ? searchParams.date! : defaultDate
  const trucks = Math.min(5, Math.max(1, Number.parseInt(searchParams.trucks ?? "1", 10) || 1))

  let error: string | null = null
  let data: Awaited<ReturnType<typeof loadRoutePlan>> | null = null
  let saved: SnowRoute[] = []
  try {
    const db = requireSupabaseAdmin()
    data = await loadRoutePlan(db, date, trucks)
    saved = (check(await db.from("snow_routes").select("*").gte("run_date", addDays(localDate(now), -14)).order("run_date", { ascending: false }).limit(20), "routes") ?? []) as SnowRoute[]
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const plan = data?.plan
  const notesById = new Map((data?.rows ?? []).map((r) => [r.sc.id, r.sc.notes]))
  const stopCount = plan?.trucks.reduce((a, t) => a + t.stops.length, 0) ?? 0

  return (
    <div className="space-y-4">
      <PageHeader title="Snow route" description="Every driveway done by your finish time. Save it and it shows on the Jobs calendar." />
      <SnowTabs active="route" />
      <RouteControls date={date} trucks={trucks} canSave={!!plan?.startAt} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t plan the route: {error}</AlertDescription>
        </Alert>
      ) : null}

      {plan?.startAt ? (
        <Card className="border-brand-green-dark bg-brand-green/10">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Leave the shop by</p>
              <p className="text-3xl font-bold tabular-nums text-ink">{time.format(plan.startAt)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">All done by</p>
              <p className="text-3xl font-bold tabular-nums text-ink">{time.format(plan.finishBy)}</p>
            </div>
            <p className="text-sm text-ink-body">
              {day.format(new Date(`${date}T12:00:00Z`))} · {stopCount} driveway{stopCount === 1 ? "" : "s"} · {plan.trucks.length} truck
              {plan.trucks.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
      ) : data && !error ? (
        <EmptyState
          icon={Truck}
          title="Nothing to route"
          description="Add snow customers with an address on the Customers tab (paused customers are left off)."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plan?.trucks.map((t) => (
          <Card key={t.truck}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="size-4 text-brand-green-dark" aria-hidden="true" />
                {plan.trucks.length > 1 ? `Truck ${t.truck}` : "Route"}: leave {time.format(t.startAt)}
              </CardTitle>
              <CardDescription>
                {t.stops.length} stops · {dur(t.workMinutes)} plowing · {dur(t.driveMinutes)} driving · done {time.format(t.finishAt)}
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
                {t.stops.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2">
                        <Link href={`/admin/snow/${s.id}`} className="truncate font-semibold text-ink hover:underline">
                          {s.name}
                        </Link>
                        <span className="shrink-0 text-sm tabular-nums text-ink">{time.format(s.arriveAt)}</span>
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {s.address ?? ""} · {s.driveMinutes}m drive · {s.minutes}m plow
                        {notesById.get(s.id) ? ` · ${notesById.get(s.id)}` : ""}
                      </p>
                    </div>
                    <PushButton id={s.id} name={s.name} size="sm" />
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>

      {plan?.unrouted.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinOff className="size-4 text-amber-600" aria-hidden="true" /> Not on the map
            </CardTitle>
            <CardDescription>These addresses couldn&apos;t be found, so they&apos;re not in the route. Fix the address to add them.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {plan.unrouted.map((s) => (
                <li key={s.id}>
                  <Link href={`/admin/snow/${s.id}`} className="font-medium text-ink underline">
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
            <CardDescription>These show on the Jobs calendar for their morning.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-ink/10">
              {saved.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/snow/route?date=${r.run_date}&trucks=${r.trucks}`} className="font-medium text-ink hover:underline">
                    {day.format(new Date(`${r.run_date}T12:00:00Z`))}: {time.format(new Date(r.start_at))}–{time.format(new Date(r.finish_at))} · {r.stops.length}{" "}
                    driveways · {r.trucks} truck{r.trucks === 1 ? "" : "s"}
                  </Link>
                  <DeleteRouteButton id={r.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
