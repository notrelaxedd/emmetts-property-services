import { HoursEditor, type DayBlocks } from "@/components/crew/hours-editor"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireCrew } from "@/lib/auth/session"
import type { CrewAvailability } from "@/lib/db/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Hours" }

export default async function CrewHoursPage() {
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  const { data } = await supabase
    .from("crew_availability")
    .select("*")
    .eq("crew_id", profile.id)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true })

  const days: DayBlocks = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const row of (data ?? []) as CrewAvailability[]) {
    days[row.weekday].push({ start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5) })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Weekly hours" description="Changes only affect jobs that aren't booked yet." />
      <HoursEditor initialDays={days} initialMaxHours={Number(profile.max_hours_week)} initialPaused={profile.paused} />
    </div>
  )
}
