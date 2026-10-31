"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { saveCanvassSettingsAction } from "@/app/admin/actions/canvass"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import type { CanvassSettingsPatch } from "@/lib/canvass/settings"
import { SERVICE_KEYS, SERVICE_LABELS } from "@/lib/canvass/types"
import type { ServiceKey } from "@/lib/canvass/types"
import type { CanvassSettings } from "@/lib/db/types"

/** Only the columns the form edits; the field map has its own form (field-map-form.tsx). */
export type CanvassSettingsFormInput = Omit<CanvassSettings, "id" | "created_at" | "updated_at" | "parcel_field_map">

type NumberKey =
  | "rate_per_1000_sqft"
  | "min_charge"
  | "hardscape_pct"
  | "value_tier_max"
  | "daytime_not_in_lf_threshold"
  | "daytime_nonworking_parent_threshold"
  | "work_hours"
  | "learned_min_knocks"
  | "doors_per_hour"
  | "neighbor_n"
  | "recency_days"

type NumberField = {
  key: NumberKey
  label: string
  hint?: string
  /** Shown as percent; stored as a fraction. */
  percent?: boolean
  prefix?: string
  suffix?: string
  step?: number
  integer?: boolean
  min?: number
  max?: number
}

const PRICING_FIELDS: NumberField[] = [
  { key: "rate_per_1000_sqft", label: "Rate per 1,000 sqft of turf", prefix: "$", step: 0.5, min: 0, hint: "Added to the base price for each 1,000 sqft of lawn" },
  { key: "min_charge", label: "Minimum charge", prefix: "$", step: 5, min: 0 },
  { key: "hardscape_pct", label: "Hardscape share of a lot", percent: true, suffix: "%", step: 1, min: 0, max: 100, hint: "Lot minus house footprint, minus this share, is the turf estimate" },
]

const TIMING_FIELDS: NumberField[] = [
  { key: "daytime_not_in_lf_threshold", label: "Daytime OK: not in labor force", percent: true, suffix: "%", step: 1, min: 0, max: 100, hint: "Share of adults in the block group not in the labor force at or above this means daytime knocks are fine" },
  { key: "daytime_nonworking_parent_threshold", label: "Daytime OK: non-working parent", percent: true, suffix: "%", step: 1, min: 0, max: 100, hint: "Share of households with a non-working parent at or above this means daytime knocks are fine" },
  { key: "work_hours", label: "Typical work day", suffix: "hours", step: 0.5, min: 0, max: 24, hint: "Used with the area's departure time and commute to guess when people are home" },
  { key: "learned_min_knocks", label: "Learned window needs", suffix: "knocks", step: 1, integer: true, min: 1, max: 1000, hint: "Knocks an area needs before its own answer history replaces the Census prior" },
]

const SESSION_FIELDS: NumberField[] = [
  { key: "doors_per_hour", label: "Doors per hour", step: 1, integer: true, min: 1, max: 200, hint: "How many houses one person can knock in an hour" },
  { key: "neighbor_n", label: "Neighbor boost within", suffix: "houses", step: 1, integer: true, min: 0, max: 50, hint: "A house this close to a customer on the same street scores higher" },
  { key: "recency_days", label: "Skip houses knocked within", suffix: "days", step: 1, integer: true, min: 0, max: 365 },
]

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const isService = (v: string): v is ServiceKey => (SERVICE_KEYS as string[]).includes(v)

function toText(f: Pick<NumberField, "percent">, v: unknown): string {
  if (v === null || v === undefined) return ""
  if (f.percent && typeof v === "number") return String(Math.round(v * 10000) / 100)
  return String(v)
}

type Draft = {
  numbers: Record<NumberKey, string>
  prices: Record<ServiceKey, string>
  value_tier_enabled: boolean
  season: Record<string, ServiceKey>
  prefixes: string
  acs_vintage: string
  offer_text: string
}

function draftFrom(initial: CanvassSettingsFormInput): Draft {
  const numbers = {} as Record<NumberKey, string>
  for (const f of [...PRICING_FIELDS, ...TIMING_FIELDS, ...SESSION_FIELDS]) numbers[f.key] = toText(f, initial[f.key])
  // Stored as a multiplier (1.05); shown as the uplift in percent (5).
  numbers.value_tier_max = String(Math.round((initial.value_tier_max - 1) * 1000) / 10)
  const prices = {} as Record<ServiceKey, string>
  for (const k of SERVICE_KEYS) prices[k] = toText({}, initial.base_prices[k])
  const season: Record<string, ServiceKey> = {}
  for (let m = 1; m <= 12; m++) {
    const v = initial.season_map[String(m)]
    season[String(m)] = v && isService(v) ? v : "mow"
  }
  return {
    numbers,
    prices,
    value_tier_enabled: initial.value_tier_enabled,
    season,
    prefixes: initial.residential_land_use_prefixes.join(", "),
    acs_vintage: initial.acs_vintage,
    offer_text: initial.offer_text ?? "",
  }
}

function NumberInput({
  f,
  id,
  value,
  onChange,
}: {
  f: NumberField
  id: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{f.label}</Label>
      <div className="flex items-center gap-1.5">
        {f.prefix ? <span className="text-sm text-ink-muted">{f.prefix}</span> : null}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={f.step ?? "any"}
          min={f.min}
          max={f.max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {f.suffix ? <span className="whitespace-nowrap text-sm text-ink-muted">{f.suffix}</span> : null}
      </div>
      {f.hint ? <p className="text-xs text-ink-muted">{f.hint}</p> : null}
    </div>
  )
}

/**
 * Every canvass_settings column except the county field map, grouped in cards. One "Save" sends the whole form as
 * a patch; the server recomputes each area's window with the new thresholds.
 */
export function CanvassSettingsForm({ initial, defaultOffer }: { initial: CanvassSettingsFormInput; defaultOffer: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(initial))

  const setNumber = (key: NumberKey, v: string) => setDraft((d) => ({ ...d, numbers: { ...d.numbers, [key]: v } }))

  const readNumber = (f: NumberField, raw: string): number | null => {
    const text = raw.trim()
    if (text === "") {
      toast({ title: `${f.label} is required`, variant: "destructive" })
      return null
    }
    const n = Number(text)
    if (!Number.isFinite(n)) {
      toast({ title: `${f.label} must be a number`, variant: "destructive" })
      return null
    }
    if (f.integer && !Number.isInteger(n)) {
      toast({ title: `${f.label} must be a whole number`, variant: "destructive" })
      return null
    }
    const value = f.percent ? Math.round(n * 100) / 10000 : n
    return value
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const patch: CanvassSettingsPatch = {}
    for (const f of [...PRICING_FIELDS, ...TIMING_FIELDS, ...SESSION_FIELDS]) {
      const v = readNumber(f, draft.numbers[f.key])
      if (v === null) return
      ;(patch as Record<string, unknown>)[f.key] = v
    }
    const tierMax = readNumber({ key: "value_tier_max", label: "Value tier max", percent: true }, draft.numbers.value_tier_max)
    if (tierMax === null) return
    // The input shows the uplift (0..10 %); the column stores the multiplier (1.00..1.10).
    patch.value_tier_max = Math.round((1 + tierMax) * 1000) / 1000
    patch.value_tier_enabled = draft.value_tier_enabled
    const prices: Partial<Record<ServiceKey, number>> = {}
    for (const k of SERVICE_KEYS) {
      const v = readNumber({ key: "min_charge", label: `${SERVICE_LABELS[k]} base price` }, draft.prices[k])
      if (v === null) return
      prices[k] = v
    }
    patch.base_prices = prices
    patch.season_map = { ...draft.season }
    const prefixes = draft.prefixes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (prefixes.length === 0) {
      toast({ title: "List at least one residential land-use prefix", variant: "destructive" })
      return
    }
    patch.residential_land_use_prefixes = Array.from(new Set(prefixes))
    const vintage = draft.acs_vintage.trim()
    if (!/^\d{4}$/.test(vintage)) {
      toast({ title: "ACS vintage is a year like 2023", variant: "destructive" })
      return
    }
    patch.acs_vintage = vintage
    patch.offer_text = draft.offer_text.trim() ? draft.offer_text.trim() : null

    startTransition(async () => {
      const r = await saveCanvassSettingsAction(patch)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save settings", description: r.reason, variant: "destructive" })
      if (r.ok) router.refresh()
    })
  }

  const tierPct = draft.numbers.value_tier_max.trim()

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>Door quotes are a range built from the base price for the season service plus the turf rate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SERVICE_KEYS.map((k) => {
              const id = `cs-price-${k}`
              return (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={id}>{SERVICE_LABELS[k]} base price</Label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-ink-muted">$</span>
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      step={1}
                      min={0}
                      value={draft.prices[k]}
                      onChange={(e) => setDraft((d) => ({ ...d, prices: { ...d.prices, [k]: e.target.value } }))}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {PRICING_FIELDS.map((f) => (
              <NumberInput key={f.key} f={f} id={`cs-${f.key}`} value={draft.numbers[f.key]} onChange={(v) => setNumber(f.key, v)} />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cs-value-tier">Value tier</Label>
              <label htmlFor="cs-value-tier" className="flex h-9 items-center gap-2 text-sm">
                <Switch
                  id="cs-value-tier"
                  checked={draft.value_tier_enabled}
                  onCheckedChange={(c) => setDraft((d) => ({ ...d, value_tier_enabled: c }))}
                />
                {draft.value_tier_enabled ? "On" : "Off"}
              </label>
              <p className="text-xs text-ink-muted">Nudges the quote up a little on higher-value homes (county market value).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-value_tier_max">Value tier max uplift</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="cs-value_tier_max"
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  min={0}
                  max={10}
                  disabled={!draft.value_tier_enabled}
                  value={tierPct}
                  onChange={(e) => setNumber("value_tier_max", e.target.value)}
                />
                <span className="text-sm text-ink-muted">%</span>
              </div>
              <p className="text-xs text-ink-muted">Up to 10%. Homes at or above $400k get the full uplift, $250k to $400k half.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timing</CardTitle>
          <CardDescription>
            How the Census block-group aggregates turn into a knock window. Always a 2-hour range or &quot;Anytime weekdays&quot;, never a minute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {TIMING_FIELDS.map((f) => (
              <NumberInput key={f.key} f={f} id={`cs-${f.key}`} value={draft.numbers[f.key]} onChange={(v) => setNumber(f.key, v)} />
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="cs-acs_vintage">ACS vintage</Label>
              <Input
                id="cs-acs_vintage"
                inputMode="numeric"
                maxLength={4}
                value={draft.acs_vintage}
                onChange={(e) => setDraft((d) => ({ ...d, acs_vintage: e.target.value }))}
              />
              <p className="text-xs text-ink-muted">Year of the ACS 5-year release to read, e.g. 2023.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>What &quot;Plan my session&quot; assumes about pace and who to skip.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SESSION_FIELDS.map((f) => (
              <NumberInput key={f.key} f={f} id={`cs-${f.key}`} value={draft.numbers[f.key]} onChange={(v) => setNumber(f.key, v)} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Season map</CardTitle>
          <CardDescription>The service the crew pitches, and the quote shown, in each month.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {MONTHS.map((name, i) => {
              const month = String(i + 1)
              const id = `cs-season-${month}`
              return (
                <div key={month} className="space-y-1.5">
                  <Label htmlFor={id}>{name}</Label>
                  <NativeSelect
                    id={id}
                    value={draft.season[month]}
                    onChange={(e) => {
                      const v = e.target.value
                      if (isService(v)) setDraft((d) => ({ ...d, season: { ...d.season, [month]: v } }))
                    }}
                  >
                    {SERVICE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {SERVICE_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>County data</CardTitle>
          <CardDescription>Which county land-use codes count as a house to knock. Everything else is dropped on pull.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="cs-prefixes">Residential land-use prefixes</Label>
            <Input
              id="cs-prefixes"
              value={draft.prefixes}
              placeholder="5"
              onChange={(e) => setDraft((d) => ({ ...d, prefixes: e.target.value }))}
            />
            <p className="text-xs text-ink-muted">Comma separated. A parcel is residential when its land-use code starts with any of these.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hangers</CardTitle>
          <CardDescription>The offer printed on door hangers. Leave it blank to use the season default.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="cs-offer">Offer text</Label>
            <Textarea
              id="cs-offer"
              rows={2}
              maxLength={500}
              value={draft.offer_text}
              placeholder={defaultOffer}
              onChange={(e) => setDraft((d) => ({ ...d, offer_text: e.target.value }))}
            />
            <p className="text-xs text-ink-muted">Season default: {defaultOffer}</p>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save canvass settings"}
      </Button>
    </form>
  )
}
