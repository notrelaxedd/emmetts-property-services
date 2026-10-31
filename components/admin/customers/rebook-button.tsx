"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RotateCcw } from "lucide-react"
import { rebookCustomer } from "@/app/admin/actions/customers"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/** "Rebook": puts the customer back into Leads as a new lead, then opens that lead (`leadHref` + id). */
export function RebookButton({ customerId, leadHref }: { customerId: string; leadHref: string }) {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await rebookCustomer(customerId)
          if (r.ok) {
            toast({ title: r.message, variant: "success" })
            router.push(`${leadHref}${r.leadId}`, { scroll: false })
          } else {
            toast({ title: "Couldn't rebook", description: r.reason, variant: "destructive" })
          }
        })
      }
    >
      <RotateCcw aria-hidden="true" /> {pending ? "Rebooking…" : "Rebook"}
    </Button>
  )
}
