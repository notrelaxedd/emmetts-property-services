import { MapBoard } from "@/components/admin/map/map-board"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { START_SLOTS } from "@/lib/routes/starts"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { loadMapData, type MapData } from "./load"

export const dynamic = "force-dynamic"
export const metadata = { title: "Map" }

export default async function MapPage({ searchParams }: { searchParams: { date?: string; from?: string } }) {
  await requireOwner()
  const today = localDate(new Date())
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "") ? searchParams.date! : today
  const from = START_SLOTS.find((s) => s.key === searchParams.from)?.key ?? null

  let error: string | null = null
  let data: MapData | null = null
  try {
    data = await loadMapData(requireSupabaseAdmin(), date)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Map" description="Every house on file, and the best route for the day's jobs." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load the map: {error}</AlertDescription>
        </Alert>
      ) : null}
      {data ? <MapBoard key={date} date={date} today={today} initialFrom={from} {...data} /> : null}
    </div>
  )
}
