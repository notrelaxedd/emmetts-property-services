import { CustomerDetailBody } from "@/components/admin/stages/customers-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customer log" }

export default async function CustomerPage({ params }: { params: { id: string } }) {
  await requireOwner()
  return <CustomerDetailBody id={params.id} />
}
