import { DoorOpen } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { WalkMode } from "@/components/canvass/walk-mode"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Walk" }

/** Walk Mode for the owner: the same screen the crew use, inside the admin shell. */
export default async function AdminWalkPage() {
  const { profile } = await requireOwner()
  return (
    <div className="mx-auto w-full max-w-[480px] space-y-4">
      <PageHeader title="Walk" description="The next good doors near you, in walking order. Log each knock as you go." />
      <CanvassTabs active="walk" />
      {getSupabaseAdmin() ? (
        <WalkMode name={profile.name} profileId={profile.id} variant="owner" />
      ) : (
        <EmptyState icon={DoorOpen} title="Not connected" description="Supabase isn't configured yet, so knocks can't be saved." />
      )}
    </div>
  )
}
