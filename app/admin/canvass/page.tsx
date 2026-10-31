import Link from "next/link"
import { Footprints, MapPinned } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { ParcelTable } from "@/components/admin/canvass/parcel-table"
import { PullPanel } from "@/components/admin/canvass/pull-panel"
import { SlotPicker } from "@/components/admin/canvass/slot-picker"
import { TopList } from "@/components/admin/canvass/top-list"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { areaLight, toMapParcel, toParcelRow } from "@/lib/canvass/admin-rows"
import type { MapParcel, ParcelRow } from "@/lib/canvass/admin-rows"
import { isResidential } from "@/lib/canvass/county"
import { loadParcelViews, slotAt } from "@/lib/canvass/load"
import { areaBanner, defaultSlot, parseHomeParams, slotLabel, topList } from "@/lib/canvass/owner-view"
import type { HomeParams } from "@/lib/canvass/owner-view"
import type { ScoreWeights } from "@/lib/canvass/types"
import { opsConfig } from "@/lib/config"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Canvass" }

const KNOCK_WINDOW_DAYS = 14

type HomeData = {
  rows: ParcelRow[]
  shapes: MapParcel[]
  top: ParcelRow[]
  moreMatching: number
  light: ReturnType<typeof areaLight>
  weights: ScoreWeights
  recencyDays: number
  season: string
  stats: { parcels: number; knockedRecently: number; doNotKnock: number; customers: number; loaded: number }
}

async function load(params: HomeParams, now: Date): Promise<HomeData> {
  const db = requireSupabaseAdmin()
  const since = new Date(now.getTime() - KNOCK_WINDOW_DAYS * 86_400_000).toISOString()
  const slot = params.date && params.start ? slotAt(params.date, params.start) : null
  const [views, parcelCount, dnkCount, recentKnocks] = await Promise.all([
    loadParcelViews(db, { slot, now }),
    db.from("parcels").select("id", { count: "exact", head: true }),
    db.from("parcels").select("id", { count: "exact", head: true }).eq("do_not_knock", true),
    db.from("knocks").select("parcel_id").gte("knocked_at", since).limit(20_000),
  ])
  check(parcelCount, "parcel count")
  check(dnkCount, "do-not-knock count")
  const knockedParcels = new Set((check(recentKnocks, "recent knocks") ?? []).map((k) => k.parcel_id))

  const { settings } = views
  const rows = views.parcels.map(toParcelRow)
  const shapes = views.parcels.map(toMapParcel).filter((s): s is MapParcel => s !== null)
  const singleFamilyIds = new Set(views.parcels.filter((p) => isResidential(p.land_use, settings.residential_land_use_prefixes)).map((p) => p.id))
  const { top, moreMatching } = topList(rows, {
    hideDnk: params.hideDnk,
    hideRecent: params.hideRecent,
    recencyDays: settings.recency_days,
    singleFamily: params.singleFamily,
    singleFamilyIds,
    now,
  })
  return {
    rows,
    shapes,
    top,
    moreMatching,
    light: areaLight(rows),
    weights: settings.score_weights,
    recencyDays: settings.recency_days,
    season: views.season.label,
    stats: {
      parcels: parcelCount.count ?? views.parcels.length,
      knockedRecently: knockedParcels.size,
      doNotKnock: dnkCount.count ?? 0,
      customers: views.customersCount,
      loaded: views.parcels.length,
    },
  }
}

export default async function CanvassPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireOwner()

  if (!getSupabaseAdmin()) {
    return (
      <div className="space-y-4">
        <PageHeader title="Canvass" />
        <CanvassTabs active="map" />
        <EmptyState icon={MapPinned} title="Not connected" description="Supabase isn't configured yet, so parcels can't be loaded or pulled." />
      </div>
    )
  }

  const params = parseHomeParams(searchParams ?? {})
  const now = new Date()
  const defaults = defaultSlot(now)
  const slotChosen = !!params.date && !!params.start

  let data: HomeData | null = null
  let error: string | null = null
  try {
    data = await load(params, now)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const banner = data ? areaBanner(data.light, slotChosen ? slotLabel(params.date as string, params.start as string) : null) : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Canvass"
        description={data ? `Door to door planning. Season focus: ${data.season}.` : "Door to door planning: pull parcels, see who to knock and when."}
      />
      <CanvassTabs active="map" />

      {error || !data || !banner ? (
        <EmptyState icon={MapPinned} title="Couldn't load the canvass map" description={error ?? undefined} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight text-ink sm:text-xl" role="status">
                <span aria-hidden="true">{banner.emoji}</span> {banner.text}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {data.stats.loaded === 0 ? "Pull a few streets to get started." : `Based on ${data.stats.loaded.toLocaleString("en-US")} houses in the area.`}
              </p>
            </div>
            <Button asChild size="cta-sm" className="w-full sm:w-auto">
              <Link href="/admin/canvass/walk">
                <Footprints /> Start walking
              </Link>
            </Button>
          </div>

          <SlotPicker
            defaults={defaults}
            active={slotChosen}
            filters={{ hideDnk: params.hideDnk, hideRecent: params.hideRecent, singleFamily: params.singleFamily }}
            recencyDays={data.recencyDays}
          />

          <section className="space-y-2" aria-labelledby="area-heading">
            <h2 id="area-heading" className="text-base font-semibold text-ink">
              Area
            </h2>
            <PullPanel shapes={data.shapes} rows={data.rows} center={[opsConfig.defaultBase.lat, opsConfig.defaultBase.lng]} />
          </section>

          <section className="space-y-2" aria-labelledby="top-heading">
            <h2 id="top-heading" className="text-base font-semibold text-ink">
              Top 25
              {slotChosen ? <span className="ml-2 text-sm font-normal text-ink-muted">for {slotLabel(params.date as string, params.start as string)}</span> : null}
            </h2>
            {data.rows.length === 0 ? (
              <EmptyState
                icon={MapPinned}
                title="No parcels yet"
                description="Open Pull parcels above the map, draw an area and pull it. Residential lots inside it are loaded from the county, with their best time to knock and a price."
              />
            ) : (
              <TopList rows={data.top} weights={data.weights} moreMatching={data.moreMatching} />
            )}
          </section>

          {data.rows.length > 0 ? (
            <details className="group rounded-lg border border-ink/10 bg-white">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-ink">
                Show all {data.rows.length.toLocaleString("en-US")} parcels
              </summary>
              <div className="border-t border-ink/10 p-2 sm:p-3">
                <ParcelTable rows={data.rows} weights={data.weights} />
              </div>
            </details>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Parcels pulled"
              value={data.stats.parcels}
              hint={data.stats.loaded < data.stats.parcels ? `Showing the newest ${data.stats.loaded}` : "Residential, from the county"}
            />
            <Stat label={`Knocked, ${KNOCK_WINDOW_DAYS} days`} value={data.stats.knockedRecently} hint="Houses with a knock logged" />
            <Stat label="Do not knock" value={data.stats.doNotKnock} hint="Never in a plan" />
            <Stat label="Customers nearby" value={data.stats.customers} hint="Parcels matched to a customer" />
          </div>
        </>
      )}
    </div>
  )
}
