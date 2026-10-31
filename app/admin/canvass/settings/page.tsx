import Link from "next/link"
import { Settings2 } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { FieldMapForm } from "@/components/admin/canvass/field-map-form"
import { CanvassSettingsForm } from "@/components/admin/canvass/settings-form"
import type { CanvassSettingsFormInput } from "@/components/admin/canvass/settings-form"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { currentSeasonFocus } from "@/lib/canvass/season"
import { getCanvassSettings } from "@/lib/canvass/settings"
import type { ParcelFieldMap } from "@/lib/canvass/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Canvass settings" }

async function load(): Promise<{ form: CanvassSettingsFormInput; fieldMap: ParcelFieldMap; defaultOffer: string }> {
  const db = requireSupabaseAdmin()
  const settings = await getCanvassSettings(db)
  // Only the columns the form edits cross to the client (the field map has its own island).
  const { id: _id, created_at: _c, updated_at: _u, parcel_field_map, ...form } = settings
  return { form, fieldMap: parcel_field_map, defaultOffer: currentSeasonFocus(settings.season_map).offer }
}

export default async function CanvassSettingsPage() {
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
      <PageHeader
        title="Canvass settings"
        description="Pricing by lawn size, the profit check, score weights, Walk pace, the season map and the county field map."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/canvass">Back to the map</Link>
          </Button>
        }
      />
      <CanvassTabs active="settings" />

      {error || !data ? (
        <EmptyState icon={Settings2} title="Couldn't load canvass settings" description={error ?? undefined} />
      ) : (
        <>
          <CanvassSettingsForm initial={data.form} defaultOffer={data.defaultOffer} />
          <FieldMapForm initial={data.fieldMap} />
        </>
      )}
    </div>
  )
}
