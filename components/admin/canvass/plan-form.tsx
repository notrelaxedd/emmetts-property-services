"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Printer, Route, Save } from "lucide-react"
import { planSessionAction, savePlanAction } from "@/app/admin/actions/canvass"
import type { LatLng } from "@/components/admin/canvass/plan-map"
import { PlanList } from "@/components/admin/canvass/plan-list"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import type { PlanView } from "@/lib/canvass/views"

const PlanMap = dynamic(() => import("@/components/admin/canvass/plan-map").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-gray-light sm:h-96" aria-hidden="true" />,
})

/** Everything but the stops list is hidden when the owner presses "Print list". */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #plan-list, #plan-list * { visibility: visible !important; }
  #plan-list { position: absolute; left: 0; top: 0; width: 100%; border: 0; box-shadow: none; }
}
`

export type PlanFormProps = {
  /** Next weekday in Ohio time, "YYYY-MM-DD". */
  defaultDate: string
  /** settings.base_lat/lng, or the configured default base. */
  base: LatLng
  baseLabel: string
}

export function PlanForm({ defaultDate, base, baseLabel }: PlanFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [date, setDate] = React.useState(defaultDate)
  const [start, setStart] = React.useState("15:00")
  const [end, setEnd] = React.useState("17:00")
  const [startMode, setStartMode] = React.useState<"base" | "map">("base")
  const [picked, setPicked] = React.useState<LatLng | null>(null)
  const [plan, setPlan] = React.useState<PlanView | null>(null)
  const [saved, setSaved] = React.useState(false)

  const startPoint: LatLng | null = startMode === "base" ? base : picked

  const planIt = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast({ title: "Pick a date", variant: "destructive" })
      return
    }
    if (end <= start) {
      toast({ title: "The slot must end after it starts", variant: "destructive" })
      return
    }
    if (startMode === "map" && !picked) {
      toast({ title: "Click the map to set the start point", description: "Or choose Use base.", variant: "destructive" })
      return
    }
    startTransition(async () => {
      const r = await planSessionAction({
        date,
        start,
        end,
        startLat: startPoint?.lat ?? null,
        startLng: startPoint?.lng ?? null,
      })
      if (!r.ok) {
        toast({ title: "Couldn't plan the session", description: r.reason, variant: "destructive" })
        return
      }
      setPlan(r.plan)
      setSaved(false)
      if (r.plan.stops.length === 0) toast({ title: "No house fits this slot", description: "Try a different time or pull more streets." })
    })
  }

  const savePlan = () => {
    if (!plan || plan.stops.length === 0) return
    startTransition(async () => {
      const r = await savePlanAction({
        date: plan.slot.date,
        start: plan.slot.start,
        end: plan.slot.end,
        parcel_ids: plan.stops.map((s) => s.id),
      })
      toast(r.ok ? { title: r.message ?? "Plan saved", variant: "success" } : { title: "Couldn't save the plan", description: r.reason, variant: "destructive" })
      if (r.ok) {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <Card className="no-print">
        <CardHeader>
          <CardTitle>Plan my session</CardTitle>
          <CardDescription>
            Picks the best houses whose knock window overlaps the slot and puts them in walking order. Do-not-knock houses and
            recent knocks are left out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={planIt} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-date">Date</Label>
                <Input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-start">Start</Label>
                <Input id="plan-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-end">End</Label>
                <Input id="plan-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-ink">Start point</legend>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-ink/20 px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
                  <input type="radio" name="start-mode" className="sr-only" checked={startMode === "base"} onChange={() => setStartMode("base")} />
                  Use base
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-ink/20 px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
                  <input type="radio" name="start-mode" className="sr-only" checked={startMode === "map"} onChange={() => setStartMode("map")} />
                  Click on the map
                </label>
              </div>
              <p className="text-xs text-ink-muted">
                {startMode === "base"
                  ? `${baseLabel}: ${base.lat.toFixed(4)}, ${base.lng.toFixed(4)}`
                  : picked
                    ? `Start at ${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`
                    : "No point picked yet."}
              </p>
            </fieldset>

            <PlanMap
              center={startPoint ?? base}
              start={startPoint}
              stops={plan?.stops ?? []}
              onPick={startMode === "map" ? (p) => setPicked(p) : undefined}
            />

            <Button type="submit" disabled={pending}>
              <Route /> {pending && !plan ? "Planning…" : "Plan session"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {plan ? (
        <>
          <PlanList plan={plan} />
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button type="button" disabled={pending || plan.stops.length === 0 || saved} onClick={savePlan}>
              <Save /> {saved ? "Saved for the logger" : "Save plan for the logger"}
            </Button>
            <Button type="button" variant="outline" disabled={plan.stops.length === 0} onClick={() => window.print()}>
              <Printer /> Print list
            </Button>
            {saved ? <span className="text-sm text-ink-muted">The Knock tab shows these stops on {plan.slot.date}.</span> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
