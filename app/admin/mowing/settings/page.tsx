import { loadMowSettings } from "@/components/admin/mowing/load"
import { MowSettingsForm } from "@/components/admin/mowing/mowing-client"
import { MowingTabs } from "@/components/admin/mowing/mowing-tabs"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Mowing settings" }

export default async function MowSettingsPage() {
  await requireOwner()
  const settings = await loadMowSettings(requireSupabaseAdmin())
  return (
    <div className="space-y-4">
      <PageHeader title="Mowing settings" description="Defaults for new customers and how the day's route is planned." />
      <MowingTabs active="settings" />
      <MowSettingsForm settings={settings} />
    </div>
  )
}
