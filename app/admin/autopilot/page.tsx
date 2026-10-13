import { Rocket } from "lucide-react"
import { AutopilotForm } from "@/components/admin/autopilot/autopilot-form"
import { BusinessSettingsForm } from "@/components/admin/autopilot/business-settings-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { Settings } from "@/lib/db/types"
import { getSettings } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Autopilot" }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export default async function AutopilotPage() {
  await requireOwner()
  let settings: Settings | null = null
  let error: string | null = null
  try {
    settings = await getSettings(requireSupabaseAdmin())
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Autopilot rules"
        description="Everything waits in your inbox by default. Turn a rule on to let that kind of action go out without your OK."
      />
      {error || !settings ? (
        <EmptyState icon={Rocket} title="Couldn't load settings" description={error ?? undefined} />
      ) : (
        <>
          <AutopilotForm initial={settings.autopilot} />
          <Card>
            <CardHeader>
              <CardTitle>Business settings</CardTitle>
              <CardDescription>Pricing, fees and limits the workers use. Items marked TODO are still open questions.</CardDescription>
            </CardHeader>
            <CardContent>
              <BusinessSettingsForm
                initial={{
                  default_wage: Number(settings.default_wage),
                  margin: Number(settings.margin),
                  min_job_price: num(settings.min_job_price),
                  card_fee_pct: Number(settings.card_fee_pct),
                  card_fee_fixed: Number(settings.card_fee_fixed),
                  drop_notice_hours: Number(settings.drop_notice_hours),
                  quote_valid_days: Number(settings.quote_valid_days),
                  invoice_days_until_due: Number(settings.invoice_days_until_due),
                  ai_monthly_cap: num(settings.ai_monthly_cap),
                  partner_tree_service_name: settings.partner_tree_service_name,
                  partner_tree_service_email: settings.partner_tree_service_email,
                  base_lat: num(settings.base_lat),
                  base_lng: num(settings.base_lng),
                }}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
