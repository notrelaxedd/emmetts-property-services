import { FleetBody } from "@/components/admin/stages/fleet-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Fleet" }

export default async function FleetPage() {
  await requireOwner()
  return <FleetBody />
}
