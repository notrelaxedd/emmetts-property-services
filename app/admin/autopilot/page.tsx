import { AutopilotBody } from "@/components/admin/stages/autopilot-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Autopilot" }

export default async function AutopilotPage() {
  await requireOwner()
  return <AutopilotBody />
}
