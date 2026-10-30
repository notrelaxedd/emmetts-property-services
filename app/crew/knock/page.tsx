import { DoorOpen } from "lucide-react"
import { KnockLogger } from "@/components/crew/knock/knock-logger"
import { EmptyState } from "@/components/ui/empty-state"
import { requireCrew } from "@/lib/auth/session"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Knock" }

/** The door-to-door logger. Everything live happens on the client (GPS, offline queue); this just gates it. */
export default async function CrewKnockPage() {
  const { profile } = await requireCrew()
  if (!getSupabaseAdmin()) {
    return (
      <EmptyState icon={DoorOpen} title="Not connected" description="Supabase isn't configured yet, so knocks can't be saved." />
    )
  }
  return <KnockLogger name={profile.name} profileId={profile.id} />
}
