import { LeadDetailBody } from "@/components/admin/stages/leads-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lead" }

export default async function LeadPage({ params }: { params: { id: string } }) {
  await requireOwner()
  return <LeadDetailBody id={params.id} />
}
