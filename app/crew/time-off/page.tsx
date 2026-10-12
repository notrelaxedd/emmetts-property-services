import { TimeOffForm, TimeOffList } from "@/components/crew/time-off"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireCrew } from "@/lib/auth/session"
import type { CrewException } from "@/lib/db/types"
import { addDays, localDate } from "@/lib/scheduler"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Time off" }

export default async function CrewTimeOffPage() {
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  const today = localDate(new Date())
  // Upcoming + the last 60 days, newest first.
  const { data } = await supabase
    .from("crew_exceptions")
    .select("*")
    .eq("crew_id", profile.id)
    .gte("date_to", addDays(today, -60))
    .order("date_from", { ascending: false })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Time off & extra days"
        description="Time off that hits a confirmed job, or starts soon, goes to the owner for an OK. Everything else is approved straight away."
      />
      <TimeOffForm today={today} />
      <TimeOffList items={(data ?? []) as CrewException[]} today={today} />
    </div>
  )
}
