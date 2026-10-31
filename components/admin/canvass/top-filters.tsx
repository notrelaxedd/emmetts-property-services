"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Switch } from "@/components/ui/switch"

export type TopFiltersProps = {
  filters: { hideDnk: boolean; hideRecent: boolean; singleFamily: boolean }
  recencyDays: number
}

/**
 * The URL is the state: a toggle rewrites `?dnk=&recent=&sf=` (a filter is on unless its param is "0") and the page
 * re-ranks. Each change builds on the last query asked for, not on `useSearchParams()` (stale until the navigation
 * commits), so a second click before the first page load lands does not drop the first change.
 */
function useParamNavigator() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const latest = React.useRef<string | null>(null)
  const committed = params.toString()
  React.useEffect(() => {
    if (!pending) latest.current = null
  }, [pending, committed])
  const go = (change: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(latest.current ?? committed)
    change(next)
    const qs = next.toString()
    latest.current = qs
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  return { go, pending }
}

/** The three default filters of the Top 25 as toggles. */
export function TopFilters({ filters, recencyDays }: TopFiltersProps) {
  const { go, pending } = useParamNavigator()
  // The switches move at once (the page reload behind them takes a moment) and follow the server again once it lands.
  const [shown, setShown] = React.useState(filters)
  React.useEffect(() => {
    if (!pending) setShown(filters)
  }, [pending, filters.hideDnk, filters.hideRecent, filters.singleFamily]) // eslint-disable-line react-hooks/exhaustive-deps

  const FILTER_KEY = { dnk: "hideDnk", recent: "hideRecent", sf: "singleFamily" } as const
  const toggle = (param: "dnk" | "recent" | "sf", on: boolean) => {
    setShown((f) => ({ ...f, [FILTER_KEY[param]]: on }))
    go((p) => (on ? p.delete(param) : p.set(param, "0")))
  }

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-ink/10 bg-white p-3 text-sm text-ink" aria-busy={pending}>
      <label className="inline-flex items-center gap-2">
        <Switch checked={shown.hideDnk} onCheckedChange={(c) => toggle("dnk", c)} aria-label="Hide do-not-knock houses" />
        Hide do not knock
      </label>
      <label className="inline-flex items-center gap-2">
        <Switch checked={shown.hideRecent} onCheckedChange={(c) => toggle("recent", c)} aria-label="Hide houses knocked recently" />
        Hide knocked in the last {recencyDays} days
      </label>
      <label className="inline-flex items-center gap-2">
        <Switch checked={shown.singleFamily} onCheckedChange={(c) => toggle("sf", c)} aria-label="Single-family homes only" />
        Single-family only
      </label>
    </div>
  )
}
