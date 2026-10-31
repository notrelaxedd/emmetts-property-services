"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export type SlotPickerProps = {
  /** What the fields show when no slot is chosen: now rounded to the hour, for two hours. */
  defaults: { date: string; start: string; end: string }
  /** The slot in the URL (what the page is ranking for), if any; the fields start from it. */
  slot?: { date: string; start: string; end: string | null } | null
  /** True when the page is ranking for a chosen slot rather than now. */
  active: boolean
  filters: { hideDnk: boolean; hideRecent: boolean; singleFamily: boolean }
  recencyDays: number
}

/**
 * The URL is the state: changing a field or a toggle rewrites `?date=&start=&end=&dnk=&recent=&sf=` and the page re-ranks.
 * Each change builds on the last query asked for, not on `useSearchParams()` (stale until the navigation commits), so a
 * second click before the first page load lands does not drop the first change.
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

/** Date + start + end, plus the three default filters as toggles. */
export function SlotPicker({ defaults, slot, active, filters, recencyDays }: SlotPickerProps) {
  const { go, pending } = useParamNavigator()
  const [date, setDate] = React.useState(slot?.date ?? defaults.date)
  const [start, setStart] = React.useState(slot?.start ?? defaults.start)
  const [end, setEnd] = React.useState(slot ? (slot.end ?? "") : defaults.end)
  // The switches move at once (the page reload behind them takes a moment) and follow the server again once it lands.
  const [shown, setShown] = React.useState(filters)
  React.useEffect(() => {
    if (!pending) setShown(filters)
  }, [pending, filters.hideDnk, filters.hideRecent, filters.singleFamily]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!date || !start) return
    go((p) => {
      p.set("date", date)
      p.set("start", start)
      if (end) p.set("end", end)
      else p.delete("end")
    })
  }

  const reset = () => {
    setDate(defaults.date)
    setStart(defaults.start)
    setEnd(defaults.end)
    go((p) => {
      p.delete("date")
      p.delete("start")
      p.delete("end")
    })
  }

  const FILTER_KEY = { dnk: "hideDnk", recent: "hideRecent", sf: "singleFamily" } as const
  const toggle = (param: "dnk" | "recent" | "sf", on: boolean) => {
    setShown((f) => ({ ...f, [FILTER_KEY[param]]: on }))
    go((p) => (on ? p.delete(param) : p.set(param, "0")))
  }

  return (
    <div className="space-y-3 rounded-lg border border-ink/10 bg-white p-3" aria-busy={pending}>
      <form onSubmit={apply} className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="space-y-1">
          <Label htmlFor="slot-date" className="text-xs">
            Day
          </Label>
          <Input id="slot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="slot-start" className="text-xs">
            From
          </Label>
          <Input id="slot-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-28" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="slot-end" className="text-xs">
            To
          </Label>
          <Input id="slot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 w-28" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          <CalendarClock /> Rank for this slot
        </Button>
        {active ? (
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
            Back to now
          </Button>
        ) : null}
      </form>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-ink/10 pt-2 text-sm text-ink">
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
    </div>
  )
}
