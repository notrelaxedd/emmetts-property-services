import { BarChart3 } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { OfferTextEditor, PitchesEditor } from "@/components/admin/canvass/pitches-editor"
import { HangerConversionsTable, KnockStatsTable, StatsCards } from "@/components/admin/canvass/stats-cards"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { loadCanvassStats } from "@/lib/canvass/load"
import { currentSeasonFocus } from "@/lib/canvass/season"
import { getCanvassSettings } from "@/lib/canvass/settings"
import { totalKnockStats } from "@/lib/canvass/stats"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Canvass stats" }

async function load() {
  const db = requireSupabaseAdmin()
  const [stats, settings] = await Promise.all([loadCanvassStats(db), getCanvassSettings(db)])
  const season = currentSeasonFocus(settings.season_map)
  return { stats, offerText: settings.offer_text, season }
}

export default async function CanvassStatsPage() {
  await requireOwner()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Canvass stats" description="Who opens the door, which pitch closes, and which streets' hangers get scanned." />
      <CanvassTabs active="stats" />

      {error || !data ? (
        <EmptyState icon={BarChart3} title="Couldn't load stats" description={error ?? undefined} />
      ) : (
        <>
          <StatsCards totals={totalKnockStats(data.stats.byKnocker)} parcels={data.stats.totals} />
          {data.stats.totals.knocks === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No knocks logged yet"
              description="Stats fill in as the crew logs knocks from the Knock tab. Pitches and the hanger offer can be set up now."
            />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <KnockStatsTable title="By knocker" rows={data.stats.byKnocker} emptyText="No knocks yet." />
            <KnockStatsTable title="By pitch" rows={data.stats.byPitch} emptyText="No knocks yet." />
          </div>
          <HangerConversionsTable rows={data.stats.hangers} />
          <div className="grid gap-4 lg:grid-cols-2">
            <PitchesEditor pitches={data.stats.pitches} />
            <OfferTextEditor initial={data.offerText} defaultOffer={data.season.offer} />
          </div>
        </>
      )}
    </div>
  )
}
