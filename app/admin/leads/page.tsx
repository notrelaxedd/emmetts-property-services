import { LeadsBody, parseLeadStatus } from "@/components/admin/stages/leads-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Leads" }

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  return <LeadsBody status={parseLeadStatus(searchParams.status)} />
}
