"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { deleteMoneyJob } from "@/app/admin/actions/money"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/** Delete a job from "Profit per job" (entered twice, say). Its quote and its money go with it. */
export function DeleteJobButton({ jobId, label }: { jobId: string; label: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const remove = () => {
    if (!window.confirm(`Delete ${label}? Its quote goes too and it comes off the Money page. A card payment isn't refunded.`)) return
    startTransition(async () => {
      const r = await deleteMoneyJob(jobId)
      toast(r.ok ? { title: r.message ?? "Deleted", variant: "success" } : { title: "Couldn't delete it", description: r.reason, variant: "destructive" })
    })
  }
  return (
    <Button variant="ghost" size="icon" className="size-8" disabled={pending} onClick={remove}>
      <Trash2 />
      <span className="sr-only">Delete this job</span>
    </Button>
  )
}
