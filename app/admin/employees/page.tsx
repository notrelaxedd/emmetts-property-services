import { EmployeesBody } from "@/components/admin/stages/employees-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Employees" }

export default async function EmployeesPage({ searchParams }: { searchParams: { removed?: string } }) {
  const showRemoved = searchParams.removed === "1"
  await requireOwner()
  return <EmployeesBody showRemoved={showRemoved} />
}
