import { MapPinned } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { ParcelTable } from "@/components/admin/canvass/parcel-table"
import { PullPanel } from "@/components/admin/canvass/pull-panel"
import { SummaryCard } from "@/components/admin/canvass/summary-card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { toMapParcel, toParcelRow } from "@/lib/canvass/admin-rows"
import type { MapParcel, ParcelRow } from "@/lib/canvass/admin-rows"
import { loadLatestSummary, loadParcelViews } from "@/lib/canvass/load"
import type { SummaryView } from "@/lib/canvass/views"
import { opsConfig } from "@/lib/config"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Canvass" }

const KNOCK_WINDOW_DAYS = 14

type HomeData = {
  rows: ParcelRow[]
  shapes: MapParcel[]
  summary: SummaryView | null
  season: string
  stats: { parcels: number; knockedRecently: number; doNotKnock: number; customers: number; loaded: number }
}

async function load(): Promise<HomeData> {
  const db = requireSupabaseAdmin()
  const since = new Date(Date.now() - KNOCK_WINDOW_DAYS * 86_400_000).toISOString()
  const [views, summary, parcelCount, dnkCount, recentKnocks] = await Promise.all([
    loadParcelViews(db),
    loadLatestSummary(db),
    db.from("parcels").select("id", { count: "exact", head: true }),
    db.from("parcels").select("id", { count: "exact", head: true }).eq("do_not_knock", true),
    db.from("knocks").select("parcel_id").gte("knocked_at", since).limit(20_000),
  ])
  check(parcelCount, "parcel count")
  check(dnkCount, "do-not-knock count")
  const knockedParcels = new Set((check(recentKnocks, "recent knocks") ?? []).map((k) => k.parcel_id))

  const rows = views.parcels.map(toParcelRow)
  const shapes = views.parcels.map(toMapParcel).filter((s): s is MapParcel => s !== null)
  return {
    rows,
    shapes,
    summary,
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

export default async function CanvassPage() {
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

  let data: HomeData | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Canvass"
        description={data ? `Door to door planning. Season focus: ${data.season}.` : "Door to door planning: pull parcels, see who to knock and when."}
      />
      <CanvassTabs active="map" />

      {error || !data ? (
        <EmptyState icon={MapPinned} title="Couldn't load the canvass map" description={error ?? undefined} />
      ) : (
        <>
          <SummaryCard summary={data.summary} />

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

          <section className="space-y-2" aria-labelledby="area-heading">
            <h2 id="area-heading" className="text-base font-semibold text-ink">
              Area
            </h2>
            <PullPanel shapes={data.shapes} rows={data.rows} center={[opsConfig.defaultBase.lat, opsConfig.defaultBase.lng]} />
          </section>

          <section className="space-y-2" aria-labelledby="parcels-heading">
            <h2 id="parcels-heading" className="text-base font-semibold text-ink">
              Parcels
            </h2>
            {data.rows.length === 0 ? (
              <EmptyState
                icon={MapPinned}
                title="No parcels yet"
                description="Draw an area on the map above and press Pull parcels. Residential lots inside it are loaded from the county, with their windows, quotes and scores."
              />
            ) : (
              <ParcelTable rows={data.rows} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
