"use client"

import * as React from "react"
import { RotateCcw } from "lucide-react"
import { requeueStale, retryTask } from "@/app/admin/actions/fleet"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

export function RetryButton({ id }: { id: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await retryTask(id)
          toast(r.ok ? { title: r.message ?? "Queued", variant: "success" } : { title: "Couldn't retry", description: r.reason, variant: "destructive" })
        })
      }
    >
      Retry
    </Button>
  )
}

export function RequeueStaleButton() {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await requeueStale()
          toast(r.ok ? { title: r.message ?? "Done", variant: "success" } : { title: "Couldn't requeue", description: r.reason, variant: "destructive" })
        })
      }
    >
      <RotateCcw /> Requeue stale
    </Button>
  )
}
