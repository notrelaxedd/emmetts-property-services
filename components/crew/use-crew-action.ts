"use client"

import * as React from "react"
import { useToast } from "@/components/ui/toast"

export type CrewActionResult = { ok: true; message?: string } | { ok: false; error: string }

/**
 * Wraps a server action call: busy state + success / error toast.
 * `run` resolves to true when the action succeeded. One action at a time per hook.
 */
export function useCrewAction() {
  const { toast } = useToast()
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  const busy = React.useRef(false)

  const run = React.useCallback(
    async (key: string, fn: () => Promise<CrewActionResult>, opts?: { quiet?: boolean }): Promise<boolean> => {
      if (busy.current) return false
      busy.current = true
      setBusyKey(key)
      try {
        const res = await fn()
        if (res.ok) {
          if (!opts?.quiet && res.message) toast({ title: res.message, variant: "success" })
          return true
        }
        toast({ title: res.error, variant: "destructive" })
        return false
      } catch {
        toast({ title: "Couldn't reach the server. Check your signal and try again.", variant: "destructive" })
        return false
      } finally {
        busy.current = false
        setBusyKey(null)
      }
    },
    [toast],
  )

  return { run, pending: busyKey !== null, busyKey }
}
