"use client"

import * as React from "react"
import { X } from "lucide-react"
import { dismissQuoteSubmission } from "@/app/admin/actions/leads"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/** Takes a quote request that didn't go through off the list (after calling them back). */
export function DismissSubmissionButton({ id, label }: { id: string; label: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const dismiss = () => {
    if (!window.confirm(`Take ${label} off the list? Do this once you've reached them.`)) return
    startTransition(async () => {
      const r = await dismissQuoteSubmission(id)
      toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: "Couldn't do that", description: r.error, variant: "destructive" })
    })
  }
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={dismiss}>
      <X />
      Done
    </Button>
  )
}
