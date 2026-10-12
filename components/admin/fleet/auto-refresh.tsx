"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/** Re-renders the server page every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const [last, setLast] = React.useState<Date | null>(null)
  React.useEffect(() => {
    setLast(new Date())
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      router.refresh()
      setLast(new Date())
    }, seconds * 1000)
    return () => window.clearInterval(t)
  }, [router, seconds])
  return (
    <span className="text-xs text-ink-muted" aria-live="off">
      Auto-refresh every {seconds}s{last ? ` · updated ${last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}
    </span>
  )
}
