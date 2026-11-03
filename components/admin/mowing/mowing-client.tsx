"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Scissors, Trash2 } from "lucide-react"
import {
  addMowCustomer,
  deleteCut,
  deleteMowRoute,
  logCut,
  removeMowCustomer,
  saveMowRoute,
  saveMowSettings,
  updateMowCustomer,
  type MowPlanInput,
} from "@/app/admin/actions/mowing"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { MowFrequency, MowSettings } from "@/lib/db/types"
import { WEEKDAYS } from "@/lib/mowing/schedule"

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v))

/** Log one mow now. */
export function CutButton({ id, name, size = "default" }: { id: string; name: string; size?: "default" | "sm" }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      size={size}
      className={size === "sm" ? "min-w-20" : "h-11 min-w-24 text-base"}
      disabled={pending}
      aria-label={`Log a cut for ${name}`}
      onClick={() => void run(() => logCut(id), { success: `Cut logged for ${name}` })}
    >
      <Scissors aria-hidden="true" />
      {pending ? "…" : "Cut"}
    </Button>
  )
}

export function DeleteCutButton({ id }: { id: string }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove this cut from the log?")) void run(() => deleteCut(id))
      }}
    >
      <Trash2 />
      <span className="sr-only">Remove this cut</span>
    </Button>
  )
}

type PlanState = { frequency: MowFrequency; price: string; minutes: string; day: string; anchor: string; notes: string }

function PlanFields({ v, set, settings }: { v: PlanState; set: (v: PlanState) => void; settings: MowSettings }) {
  const ids = { f: React.useId(), p: React.useId(), m: React.useId(), d: React.useId(), a: React.useId() }
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.f}>How often</Label>
        <NativeSelect id={ids.f} value={v.frequency} onChange={(e) => set({ ...v, frequency: e.target.value as MowFrequency })}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.p}>Price per cut ($)</Label>
        <Input id={ids.p} type="number" inputMode="decimal" min={0} step="0.01" value={v.price} onChange={(e) => set({ ...v, price: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.m}>Minutes per cut</Label>
        <Input
          id={ids.m}
          type="number"
          inputMode="numeric"
          min={1}
          max={480}
          value={v.minutes}
          placeholder={`${settings.default_minutes} (default)`}
          onChange={(e) => set({ ...v, minutes: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.d}>Mow day</Label>
        <NativeSelect id={ids.d} value={v.day} onChange={(e) => set({ ...v, day: e.target.value })}>
          <option value="">Any day</option>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </NativeSelect>
      </div>
      {v.frequency === "biweekly" ? (
        <div className="grid gap-1.5">
          <Label htmlFor={ids.a}>First cut (sets which weeks)</Label>
          <Input id={ids.a} type="date" value={v.anchor} onChange={(e) => set({ ...v, anchor: e.target.value })} />
        </div>
      ) : null}
    </>
  )
}

const toInput = (v: PlanState): MowPlanInput => ({
  frequency: v.frequency,
  price: Number(v.price),
  est_minutes: numOrNull(v.minutes),
  preferred_day: numOrNull(v.day),
  anchor_date: v.anchor,
  notes: v.notes || null,
})

export function AddMowCustomerForm({ settings, existing, today }: { settings: MowSettings; existing: { id: string; name: string }[]; today: string }) {
  const { pending, run } = useActionRunner()
  const blank: PlanState = { frequency: "weekly", price: String(settings.default_price), minutes: "", day: "", anchor: today, notes: "" }
  const [v, setV] = React.useState<PlanState>(blank)
  const [customerId, setCustomerId] = React.useState("")
  const [who, setWho] = React.useState({ name: "", phone: "", address: "" })
  const ids = { c: React.useId(), n: React.useId(), ph: React.useId(), a: React.useId() }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add a mowing customer</CardTitle>
        <CardDescription>Pick someone already on file, or type a new one. The address puts them on the route.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => addMowCustomer({ customer_id: customerId || null, ...who }, toInput(v)), {
              onSuccess: () => {
                setV(blank)
                setCustomerId("")
                setWho({ name: "", phone: "", address: "" })
              },
            })
          }}
        >
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor={ids.c}>Customer</Label>
            <NativeSelect id={ids.c} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">New customer…</option>
              {existing.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {customerId ? null : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.n}>Name</Label>
                <Input id={ids.n} value={who.name} maxLength={120} onChange={(e) => setWho({ ...who, name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.ph}>Phone</Label>
                <Input id={ids.ph} type="tel" value={who.phone} maxLength={40} onChange={(e) => setWho({ ...who, phone: e.target.value })} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor={ids.a}>Address</Label>
                <Input
                  id={ids.a}
                  value={who.address}
                  maxLength={300}
                  placeholder="123 Lake Rd, Rocky River, OH"
                  onChange={(e) => setWho({ ...who, address: e.target.value })}
                />
              </div>
            </>
          )}
          <PlanFields v={v} set={setV} settings={settings} />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add to mowing"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function MowPlanForm({
  id,
  settings,
  initial,
}: {
  id: string
  settings: MowSettings
  initial: { frequency: MowFrequency; price: number; est_minutes: number | null; preferred_day: number | null; anchor_date: string; notes: string | null; active: boolean; address: string }
}) {
  const router = useRouter()
  const { pending, run } = useActionRunner()
  const [v, setV] = React.useState<PlanState>({
    frequency: initial.frequency,
    price: String(initial.price),
    minutes: initial.est_minutes === null ? "" : String(initial.est_minutes),
    day: initial.preferred_day === null ? "" : String(initial.preferred_day),
    anchor: initial.anchor_date,
    notes: initial.notes ?? "",
  })
  const [active, setActive] = React.useState(initial.active)
  const [address, setAddress] = React.useState(initial.address)
  const ids = { n: React.useId(), a: React.useId(), act: React.useId() }
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => updateMowCustomer(id, { ...toInput(v), active, address }))
      }}
    >
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={ids.a}>Address</Label>
        <Input id={ids.a} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <PlanFields v={v} set={setV} settings={settings} />
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={ids.n}>Notes (gate code, dog, where to dump clippings…)</Label>
        <Textarea id={ids.n} rows={2} value={v.notes} maxLength={500} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Switch id={ids.act} checked={active} onCheckedChange={setActive} />
        <Label htmlFor={ids.act}>Active (on the route)</Label>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Take them off mowing? Their cut log is deleted too.")) {
              void run(() => removeMowCustomer(id), { onSuccess: () => router.push("/admin/mowing") })
            }
          }}
        >
          <Trash2 aria-hidden="true" /> Remove from mowing
        </Button>
      </div>
    </form>
  )
}

export function MowSettingsForm({ settings }: { settings: MowSettings }) {
  const { pending, run } = useActionRunner()
  const [v, setV] = React.useState({
    default_price: String(settings.default_price),
    default_minutes: String(settings.default_minutes),
    drive_mph: String(settings.drive_mph),
    start_time: settings.start_time.slice(0, 5),
    season_start: settings.season_start ?? "",
    season_end: settings.season_end ?? "",
  })
  const field = (key: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`mow-${key}`}>{label}</Label>
      <Input id={`mow-${key}`} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} {...props} />
    </div>
  )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void run(() =>
          saveMowSettings({
            default_price: Number(v.default_price),
            default_minutes: Number(v.default_minutes),
            drive_mph: Number(v.drive_mph),
            start_time: v.start_time,
            season_start: v.season_start || null,
            season_end: v.season_end || null,
          }),
        )
      }}
      className="space-y-4"
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Season</CardTitle>
          <CardDescription>Outside these dates no lawn is due and the route is empty. Leave one blank for no limit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("season_start", "Season starts", { type: "date" })}
          {field("season_end", "Season ends", { type: "date" })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Defaults</CardTitle>
          <CardDescription>New customers start with these. Each customer can have their own price and minutes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("default_price", "Price per cut ($)", { type: "number", inputMode: "decimal", min: 0, step: "0.01" })}
          {field("default_minutes", "Minutes per cut", { type: "number", inputMode: "numeric", min: 1, max: 480 })}
          {field("start_time", "Route starts at", { type: "time" })}
          {field("drive_mph", "Driving speed (mph)", { type: "number", inputMode: "decimal", min: 1, max: 80 })}
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save mowing settings"}
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}

export function MowRouteControls({ date, trucks, canSave }: { date: string; trucks: number; canSave: boolean }) {
  const router = useRouter()
  const { pending, run } = useActionRunner()
  const ids = { d: React.useId(), t: React.useId() }
  const go = (d: string, t: number) => router.push(`/admin/mowing/route?date=${d}&trucks=${t}`)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={ids.d}>Day</Label>
        <Input id={ids.d} type="date" value={date} onChange={(e) => e.target.value && go(e.target.value, trucks)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.t}>Mowers / crews</Label>
        <NativeSelect id={ids.t} value={String(trucks)} onChange={(e) => go(date, Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="button" disabled={pending || !canSave} onClick={() => void run(() => saveMowRoute(date, trucks))}>
        {pending ? "Saving…" : "Save to Jobs calendar"}
      </Button>
    </div>
  )
}

export function DeleteMowRouteButton({ id }: { id: string }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove this saved route from the calendar?")) void run(() => deleteMowRoute(id))
      }}
    >
      <Trash2 aria-hidden="true" /> Remove
    </Button>
  )
}
