import { CustomersBody } from "@/components/admin/stages/customers-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customers" }

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireOwner()
  const q = typeof searchParams.q === "string" ? searchParams.q.slice(0, 100) : ""
  return <CustomersBody q={q} />
}
