"use client"

import * as React from "react"
import { useToast } from "@/components/ui/toast"
import { decide as decideAction } from "@/app/admin/actions/approvals"
import type { ApprovalDecision } from "@/lib/ops/approvals"
import type { ActionResult } from "./types"

export type RunOptions = { success?: string; onSuccess?: () => void }

/** Runs a server action, tracks `pending`, and toasts the outcome (warnings stay until dismissed). */
export function useActionRunner() {
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (fn: () => Promise<ActionResult>, opts: RunOptions = {}): Promise<ActionResult> => {
      setPending(true)
      try {
        const res = await fn()
        if (!res.ok) {
          toast({ title: "That didn't go through", description: res.error, variant: "destructive", duration: 8000 })
        } else if (res.warning) {
          toast({
            title: `${res.message ?? "Saved"}, but the follow-up step failed`,
            description: `${res.warning} (Noted on the item; retry it from Decided.)`,
            variant: "destructive",
            duration: 0,
          })
          opts.onSuccess?.()
        } else {
          toast({ title: opts.success ?? res.message ?? "Done", variant: "success" })
          opts.onSuccess?.()
        }
        return res
      } catch (e) {
        const error = e instanceof Error ? e.message : "Something went wrong"
        toast({ title: "That didn't go through", description: error, variant: "destructive", duration: 8000 })
        return { ok: false, error }
      } finally {
        setPending(false)
      }
    },
    [toast],
  )

  return { pending, run }
}

export type Decider = {
  pending: boolean
  decide: (
    decision: ApprovalDecision,
    opts?: { note?: string; payloadPatch?: Record<string, unknown> },
    runOpts?: RunOptions,
  ) => Promise<ActionResult>
}

/** `decide(...)` bound to one approval, sharing a single pending flag across the card's buttons. */
export function useDecide(approvalId: string): Decider {
  const { pending, run } = useActionRunner()
  const decide = React.useCallback<Decider["decide"]>(
    (decision, opts = {}, runOpts) => run(() => decideAction(approvalId, decision, opts), runOpts),
    [approvalId, run],
  )
  return { pending, decide }
}
