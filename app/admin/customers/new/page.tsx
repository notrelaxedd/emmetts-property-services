import { AddCustomerCard } from "@/components/admin/stages/customers-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Add a customer" }

export default async function NewCustomerPage() {
  await requireOwner()
  return <AddCustomerCard />
}
