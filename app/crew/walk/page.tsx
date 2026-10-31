import { DoorOpen } from "lucide-react"
import { WalkMode } from "@/components/canvass/walk-mode"
import { EmptyState } from "@/components/ui/empty-state"
import { requireCrew } from "@/lib/auth/session"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Walk" }

/** Walk Mode for the crew: GPS, the offline queue and the route all live on the client; this just gates it. */
export default async function CrewWalkPage() {
  const { profile } = await requireCrew()
  if (!getSupabaseAdmin()) {
    return <EmptyState icon={DoorOpen} title="Not connected" description="Supabase isn't configured yet, so knocks can't be saved." />
  }
  return <WalkMode name={profile.name} profileId={profile.id} variant="crew" />
}
