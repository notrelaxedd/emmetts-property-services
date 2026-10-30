import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { AddCustomerForm } from "@/components/admin/customers/add-customer-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Add a customer" }

export default async function NewCustomerPage() {
  await requireOwner()
  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/customers">
          <ArrowLeft aria-hidden="true" /> Customers
        </Link>
      </Button>
      <PageHeader title="Add a customer" description="Put someone on file you've done work for, or plan to." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Who they are</CardTitle>
          <CardDescription>
            Only the name is required. Their page opens next, where you can add a paid job or fill in more later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddCustomerForm />
        </CardContent>
      </Card>
    </div>
  )
}
