import { Route } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { PlanForm } from "@/components/admin/canvass/plan-form"
import type { PlanFormProps } from "@/components/admin/canvass/plan-form"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { opsConfig } from "@/lib/config"
import { getSettings } from "@/lib/ops/settings"
import { addDays, localDate, weekdayOf } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Plan my session" }

/** The next Monday to Friday after today (Ohio time). */
function nextWeekday(today: string): string {
  let d = addDays(today, 1)
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1)
  return d
}

async function load(): Promise<PlanFormProps> {
  const db = requireSupabaseAdmin()
  const settings = await getSettings(db)
  const hasBase = settings.base_lat !== null && settings.base_lng !== null
  return {
    defaultDate: nextWeekday(localDate(new Date())),
    base: hasBase ? { lat: settings.base_lat as number, lng: settings.base_lng as number } : { ...opsConfig.defaultBase },
    baseLabel: hasBase ? "Base (business settings)" : "Default base (Rocky River)",
  }
}

export default async function CanvassPlanPage() {
  await requireOwner()
  let data: PlanFormProps | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plan my session"
        description="Pick a day and how many hours you will walk. The planner picks the houses most likely to buy, in walking order."
      />
      <CanvassTabs active="plan" />

      {error || !data ? <EmptyState icon={Route} title="Couldn't load the planner" description={error ?? undefined} /> : <PlanForm {...data} />}
    </div>
  )
}
