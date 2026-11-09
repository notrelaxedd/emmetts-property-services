"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Snowflake, Trash2 } from "lucide-react"
import {
  addSnowCustomer,
  deletePush,
  deleteSnowRoute,
  logPush,
  removeSnowCustomer,
  saveSnowRoute,
  saveSnowSettings,
  setSnowBill,
  updateSnowCustomer,
} from "@/app/admin/actions/snow"
import { setMowBill } from "@/app/admin/actions/mowing"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { SnowPayMethod, SnowSettings } from "@/lib/db/types"

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v))

/** The one big button: log a plow visit now. */
export function PushButton({ id, name, size = "default" }: { id: string; name: string; size?: "default" | "sm" }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      size={size}
      className={size === "sm" ? "min-w-20" : "h-11 min-w-24 text-base"}
      disabled={pending}
      aria-label={`Push for ${name}`}
      onClick={() => void run(() => logPush(id), { success: `Push logged for ${name}` })}
    >
      <Snowflake aria-hidden="true" />
      {pending ? "…" : "Push"}
    </Button>
  )
}

export function DeletePushButton({ id }: { id: string }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove this push from the log?")) void run(() => deletePush(id))
      }}
    >
      <Trash2 />
      <span className="sr-only">Remove this push</span>
    </Button>
  )
}

/** Price per push and minutes per driveway. Every snow customer is billed per push. */
function PlanFields({
  price,
  setPrice,
  minutes,
  setMinutes,
  defaults,
}: {
  price: string
  setPrice: (v: string) => void
  minutes: string
  setMinutes: (v: string) => void
  defaults: SnowSettings
}) {
  const ids = { pr: React.useId(), m: React.useId() }
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.pr}>Price per push ($)</Label>
        <Input id={ids.pr} type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.m}>Minutes per push</Label>
        <Input
          id={ids.m}
          type="number"
          inputMode="numeric"
          min={1}
          max={240}
          value={minutes}
          placeholder={`${defaults.default_minutes} (default)`}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </div>
    </>
  )
}

/** Add a snow customer: pick someone on file, or type a new one. */
export function AddSnowCustomerForm({ settings, existing }: { settings: SnowSettings; existing: { id: string; name: string; snow: boolean }[] }) {
  const { pending, run } = useActionRunner()
  const [customerId, setCustomerId] = React.useState("")
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [price, setPrice] = React.useState(String(settings.default_per_push))
  const [minutes, setMinutes] = React.useState("")
  const ids = { c: React.useId(), n: React.useId(), ph: React.useId(), a: React.useId() }
  const reset = () => {
    setCustomerId("")
    setName("")
    setPhone("")
    setAddress("")
    setMinutes("")
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add a snow customer</CardTitle>
        <CardDescription>Pick someone already on file, or type a new one. The address puts them on the route.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void run(
              () =>
                addSnowCustomer(
                  { customer_id: customerId || null, name, phone, address },
                  { per_push_price: numOrNull(price), est_minutes: numOrNull(minutes), notes: null },
                ),
              { onSuccess: reset },
            )
          }}
        >
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor={ids.c}>Customer</Label>
            <NativeSelect id={ids.c} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">New customer…</option>
              {existing.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.snow ? " (snow list)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          {customerId ? null : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.n}>Name</Label>
                <Input id={ids.n} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.ph}>Phone</Label>
                <Input id={ids.ph} type="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor={ids.a}>Address</Label>
                <Input id={ids.a} value={address} maxLength={300} placeholder="123 Lake Rd, Rocky River, OH" onChange={(e) => setAddress(e.target.value)} />
              </div>
            </>
          )}
          <PlanFields price={price} setPrice={setPrice} minutes={minutes} setMinutes={setMinutes} defaults={settings} />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add to snow"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Edit one snow customer's price, minutes, notes and address (their page). */
export function SnowPlanForm({
  id,
  settings,
  initial,
}: {
  id: string
  settings: SnowSettings
  initial: { per_push_price: number | null; est_minutes: number | null; notes: string | null; active: boolean; address: string }
}) {
  const router = useRouter()
  const { pending, run } = useActionRunner()
  const [price, setPrice] = React.useState(String(initial.per_push_price ?? settings.default_per_push))
  const [minutes, setMinutes] = React.useState(initial.est_minutes === null ? "" : String(initial.est_minutes))
  const [notes, setNotes] = React.useState(initial.notes ?? "")
  const [active, setActive] = React.useState(initial.active)
  const [address, setAddress] = React.useState(initial.address)
  const ids = { n: React.useId(), a: React.useId(), act: React.useId() }
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() =>
          updateSnowCustomer(id, {
            per_push_price: numOrNull(price),
            est_minutes: numOrNull(minutes),
            notes: notes || null,
            active,
            address,
          }),
        )
      }}
    >
      <div className="grid gap-1.5 sm:col-span-3">
        <Label htmlFor={ids.a}>Address</Label>
        <Input id={ids.a} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <PlanFields price={price} setPrice={setPrice} minutes={minutes} setMinutes={setMinutes} defaults={settings} />
      <div className="grid gap-1.5 sm:col-span-3">
        <Label htmlFor={ids.n}>Notes (gate code, where to pile snow…)</Label>
        <Textarea id={ids.n} rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 sm:col-span-3">
        <Switch id={ids.act} checked={active} onCheckedChange={setActive} />
        <Label htmlFor={ids.act}>Active this winter (on the route)</Label>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Take them off snow? Their push log is deleted too.")) {
              void run(() => removeSnowCustomer(id), { onSuccess: () => router.push("/admin/snow") })
            }
          }}
        >
          <Trash2 aria-hidden="true" /> Remove from snow
        </Button>
      </div>
    </form>
  )
}

/** Per-push pricing and route defaults. */
export function SnowSettingsForm({ settings }: { settings: SnowSettings }) {
  const { pending, run } = useActionRunner()
  const [v, setV] = React.useState({
    default_per_push: String(settings.default_per_push),
    finish_by: settings.finish_by.slice(0, 5),
    default_minutes: String(settings.default_minutes),
    drive_mph: String(settings.drive_mph),
    trigger_inches: String(settings.trigger_inches),
  })
  const field = (key: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`snow-${key}`}>{label}</Label>
      <Input id={`snow-${key}`} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} {...props} />
    </div>
  )
  const n = { type: "number", inputMode: "decimal" as const, min: 0, step: "0.01" }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() =>
          saveSnowSettings({
            default_per_push: Number(v.default_per_push),
            finish_by: v.finish_by,
            default_minutes: Number(v.default_minutes),
            drive_mph: Number(v.drive_mph),
            trigger_inches: Number(v.trigger_inches),
          }),
        )
      }}
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pricing</CardTitle>
          <CardDescription>Everyone is billed per push. New customers start at this price; you can set each customer&apos;s own on their page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {field("default_per_push", "Default price per push ($)", n)}
          {field("trigger_inches", "Plow at (inches)", { ...n, step: "0.5" })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Route</CardTitle>
          <CardDescription>The route is worked back from this time so every driveway is done by then.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {field("finish_by", "Finish every driveway by", { type: "time" })}
          {field("default_minutes", "Minutes per driveway (default)", { type: "number", inputMode: "numeric", min: 1, max: 240 })}
          {field("drive_mph", "Snow-day driving speed (mph)", { type: "number", inputMode: "decimal", min: 1, max: 80 })}
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save snow settings"}
      </Button>
    </form>
  )
}

/** Route page: pick the morning and trucks, save it to the calendar. */
export function RouteControls({ date, trucks, canSave }: { date: string; trucks: number; canSave: boolean }) {
  const router = useRouter()
  const { pending, run } = useActionRunner()
  const ids = { d: React.useId(), t: React.useId() }
  const go = (d: string, t: number) => router.push(`/admin/snow/route?date=${d}&trucks=${t}`)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={ids.d}>Morning of</Label>
        <Input id={ids.d} type="date" value={date} onChange={(e) => e.target.value && go(e.target.value, trucks)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.t}>Trucks / crews</Label>
        <NativeSelect id={ids.t} value={String(trucks)} onChange={(e) => go(date, Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="button" disabled={pending || !canSave} onClick={() => void run(() => saveSnowRoute(date, trucks))}>
        {pending ? "Saving…" : "Save to Jobs calendar"}
      </Button>
    </div>
  )
}

export function DeleteRouteButton({ id }: { id: string }) {
  const { pending, run } = useActionRunner()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove this saved route from the calendar?")) void run(() => deleteSnowRoute(id))
      }}
    >
      <Trash2 aria-hidden="true" /> Remove
    </Button>
  )
}

/** One bill's "pays by" and "paid" controls on the Snow and Mowing Bills pages. */
export function BillControls({
  id,
  month,
  name,
  payMethod,
  paid,
  kind = "snow",
}: {
  id: string
  month: string
  name: string
  payMethod: SnowPayMethod | null
  paid: boolean
  kind?: "snow" | "mow"
}) {
  const { pending, run } = useActionRunner()
  const setBill = kind === "mow" ? setMowBill : setSnowBill
  const [method, setMethod] = React.useState<string>(payMethod ?? "")
  const [isPaid, setIsPaid] = React.useState(paid)
  React.useEffect(() => setMethod(payMethod ?? ""), [payMethod])
  React.useEffect(() => setIsPaid(paid), [paid])
  const ids = { m: React.useId(), p: React.useId() }
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={ids.m} className="sr-only">
        How {name} pays
      </label>
      <NativeSelect
        id={ids.m}
        className="h-9 w-28"
        value={method}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value
          setMethod(v)
          void run(() => setBill({ id, month, pay_method: v || null }), { success: v ? `${name}: pays by ${v}` : "Saved" })
        }}
      >
        <option value="">Pays by…</option>
        <option value="cash">Cash</option>
        <option value="card">Card</option>
        <option value="check">Check</option>
      </NativeSelect>
      <span className="flex items-center gap-1.5">
        <Checkbox
          id={ids.p}
          checked={isPaid}
          disabled={pending}
          onCheckedChange={(v) => {
            const next = v === true
            setIsPaid(next)
            void run(() => setBill({ id, month, paid: next }))
          }}
        />
        <Label htmlFor={ids.p} className={isPaid ? "font-semibold text-brand-green-dark" : "text-ink-muted"}>
          {isPaid ? "Paid" : "Not paid"}
        </Label>
      </span>
    </div>
  )
}
