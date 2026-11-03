import { loadSnowSettings } from "@/components/admin/snow/load"
import { SnowSettingsForm } from "@/components/admin/snow/snow-client"
import { SnowTabs } from "@/components/admin/snow/snow-tabs"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Snow settings" }

export default async function SnowSettingsPage() {
  await requireOwner()
  const settings = await loadSnowSettings(requireSupabaseAdmin())
  return (
    <div className="space-y-4">
      <PageHeader title="Plans & settings" description="Monthly plan prices and how the morning route is planned." />
      <SnowTabs active="settings" />
      <SnowSettingsForm settings={settings} />
    </div>
  )
}
