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
import {
  boundsDraftFrom,
  boundsSummary,
  parseBounds,
  parseTierDraft,
  parseWeights,
  pricePlaceholder,
  tierDraftFrom,
  weightsDraftFrom,
} from "@/lib/canvass/tier-form"
import type { BoundsDraft, TierDraft, WeightsDraft } from "@/lib/canvass/tier-form"
import { SERVICE_KEYS, SERVICE_LABELS, TIER_KEYS, TIER_LABELS } from "@/lib/canvass/types"
import type { ScoreWeights, ServiceKey, TierKey } from "@/lib/canvass/types"
import type { CanvassSettings } from "@/lib/db/types"

/** Only the columns the form edits; the field map has its own form (field-map-form.tsx). */
export type CanvassSettingsFormInput = Omit<CanvassSettings, "id" | "created_at" | "updated_at" | "parcel_field_map">

type NumberKey =
  | "hardscape_pct"
  | "crew_size"
  | "pay_rate"
  | "walk_doors"
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
  /** Not used by the input, which steps by 1 for `integer` fields and takes any value otherwise (17.5 %, $15.10), so the browser never blocks a value the server accepts. */
  step?: number
  integer?: boolean
  min?: number
  max?: number
}

const PRICING_FIELDS: NumberField[] = [
  { key: "hardscape_pct", label: "Hardscape share of a lot", percent: true, suffix: "%", step: 1, min: 0, max: 100, hint: "Lot minus house footprint, minus this share, is the turf estimate" },
]

const PROFIT_FIELDS: NumberField[] = [
  { key: "crew_size", label: "Crew size", suffix: "people", step: 1, integer: true, min: 1, max: 50, hint: "People on one job. Labor cost is crew size times pay rate times minutes" },
  { key: "pay_rate", label: "Pay rate", prefix: "$", suffix: "per person per hour", step: 0.25, min: 0, max: 1000, hint: "Used only for the owner's profit check" },
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
  { key: "walk_doors", label: "Doors in one Walk", suffix: "doors", step: 1, integer: true, min: 1, max: 200, hint: "How many houses Walk lines up when someone presses Start walking" },
]

const SCORE_WEIGHT_FIELDS: { key: keyof ScoreWeights; label: string; hint: string }[] = [
  { key: "time", label: "Time", hint: "Is it a good time to knock" },
  { key: "lawn", label: "Lawn", hint: "Bigger lawn, bigger job" },
  { key: "customer", label: "Customer nearby", hint: "A neighbor already uses you" },
  { key: "owner", label: "Owner", hint: "Owner-occupied beats a rental" },
]

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const isService = (v: string): v is ServiceKey => (SERVICE_KEYS as string[]).includes(v)

const ALL_FIELDS = [...PRICING_FIELDS, ...PROFIT_FIELDS, ...TIMING_FIELDS, ...SESSION_FIELDS]

function toText(f: Pick<NumberField, "percent">, v: unknown): string {
  if (v === null || v === undefined) return ""
  if (f.percent && typeof v === "number") return String(Math.round(v * 10000) / 100)
  return String(v)
}

type Draft = {
  numbers: Record<NumberKey, string>
  prices: TierDraft
  minutes: TierDraft
  bounds: BoundsDraft
  weights: WeightsDraft
  value_tier_enabled: boolean
  season: Record<string, ServiceKey>
  prefixes: string
  acs_vintage: string
  offer_text: string
}

function draftFrom(initial: CanvassSettingsFormInput): Draft {
  const numbers = {} as Record<NumberKey, string>
  for (const f of ALL_FIELDS) numbers[f.key] = toText(f, initial[f.key])
  // Stored as a multiplier (1.05); shown as the uplift in percent (5).
  numbers.value_tier_max = String(Math.round((initial.value_tier_max - 1) * 1000) / 10)
  const season: Record<string, ServiceKey> = {}
  for (let m = 1; m <= 12; m++) {
    const v = initial.season_map[String(m)]
    season[String(m)] = v && isService(v) ? v : "mow"
  }
  return {
    numbers,
    prices: tierDraftFrom(initial.price_tiers),
    minutes: tierDraftFrom(initial.tier_minutes),
    bounds: boundsDraftFrom(initial.tier_bounds),
    weights: weightsDraftFrom(initial.score_weights),
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
          step={f.integer ? 1 : "any"}
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

/** A services-by-tiers grid of number inputs. Blank is a real value (null), so the placeholder says what blank means. */
function TierGrid({
  idPrefix,
  caption,
  draft,
  onChange,
  placeholderFor,
  prefix,
  suffix,
}: {
  idPrefix: string
  caption: string
  draft: TierDraft
  onChange: (service: ServiceKey, tier: TierKey, value: string) => void
  placeholderFor: (tier: TierKey) => string
  prefix?: string
  suffix?: string
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] border-separate border-spacing-x-2 border-spacing-y-1.5 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs font-medium text-ink-muted">
            <th scope="col" className="w-32 pb-0.5 font-medium">
              Service
            </th>
            {TIER_KEYS.map((t) => (
              <th key={t} scope="col" className="pb-0.5 font-medium">
                {TIER_LABELS[t]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SERVICE_KEYS.map((k) => (
            <tr key={k}>
              <th scope="row" className="pr-2 text-left font-medium text-ink">
                {SERVICE_LABELS[k]}
              </th>
              {TIER_KEYS.map((t) => (
                <td key={t}>
                  <div className="flex items-center gap-1">
                    {prefix ? <span className="text-ink-muted">{prefix}</span> : null}
                    <Input
                      id={`${idPrefix}-${k}-${t}`}
                      aria-label={`${SERVICE_LABELS[k]}, ${TIER_LABELS[t]} lawn`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      value={draft[k][t]}
                      placeholder={placeholderFor(t)}
                      onChange={(e) => onChange(k, t, e.target.value)}
                      className="h-9 min-w-[5.5rem] px-2 text-sm placeholder:text-xs"
                    />
                    {suffix ? <span className="text-xs text-ink-muted">{suffix}</span> : null}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
    for (const f of ALL_FIELDS) {
      const v = readNumber(f, draft.numbers[f.key])
      if (v === null) return
      ;(patch as Record<string, unknown>)[f.key] = v
    }
    const tierMax = readNumber({ key: "value_tier_max", label: "Value tier max", percent: true }, draft.numbers.value_tier_max)
    if (tierMax === null) return
    // The input shows the uplift (0..10 %); the column stores the multiplier (1.00..1.10).
    patch.value_tier_max = Math.round((1 + tierMax) * 1000) / 1000
    patch.value_tier_enabled = draft.value_tier_enabled
    // Every cell goes up, a blank one as null, so clearing a price really clears it on the server.
    const prices = parseTierDraft(draft.prices, "price")
    if (!prices.ok) {
      toast({ title: prices.error, variant: "destructive" })
      return
    }
    patch.price_tiers = prices.table
    const minutes = parseTierDraft(draft.minutes, "minutes")
    if (!minutes.ok) {
      toast({ title: minutes.error, variant: "destructive" })
      return
    }
    patch.tier_minutes = minutes.table
    const bounds = parseBounds(draft.bounds)
    if (!bounds.ok) {
      toast({ title: bounds.error, variant: "destructive" })
      return
    }
    patch.tier_bounds = bounds.bounds
    const weights = parseWeights(draft.weights)
    if (!weights.ok) {
      toast({ title: weights.error, variant: "destructive" })
      return
    }
    patch.score_weights = weights.weights
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
  const parsedBounds = parseBounds(draft.bounds)
  const boundsPreview = parsedBounds.ok ? boundsSummary(parsedBounds.bounds) : parsedBounds.error

  return (
    // noValidate: the submit handler (readNumber, parseBounds, parseTierDraft) and the server schema validate and say why in a toast.
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>
            One price per service for each lawn size. The door quote is the price for the lawn tier the house falls in. Leave a price blank
            until you decide it; a blank XL price means &quot;Quote on site&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TierGrid
            idPrefix="cs-price"
            caption="Price per service and lawn tier, in dollars"
            draft={draft.prices}
            onChange={(service, tier, v) => setDraft((d) => ({ ...d, prices: { ...d.prices, [service]: { ...d.prices[service], [tier]: v } } }))}
            placeholderFor={pricePlaceholder}
            prefix="$"
          />
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Lawn size tiers (turf sqft)</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["small_max", "Small up to"],
                  ["medium_max", "Medium up to"],
                  ["large_max", "Large up to"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`cs-bounds-${key}`}>{label}</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`cs-bounds-${key}`}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      value={draft.bounds[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, bounds: { ...d.bounds, [key]: e.target.value } }))}
                    />
                    <span className="whitespace-nowrap text-sm text-ink-muted">sqft</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              {boundsPreview ?? "Each bound must be higher than the one before."} Turf is the lawn, not the whole lot.
            </p>
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
              <p className="text-xs text-ink-muted">Nudges a priced quote up a little on higher-value homes (county market value).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-value_tier_max">Value tier max uplift</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="cs-value_tier_max"
                  type="number"
                  inputMode="decimal"
                  step="any"
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
          <CardTitle>Profit check</CardTitle>
          <CardDescription>
            How long a job takes your crew, by service and lawn tier. With minutes, crew size and pay rate filled in, the house page shows labor cost
            and profit and flags any price that falls under labor cost. Only you see this; the crew sees the price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TierGrid
            idPrefix="cs-minutes"
            caption="Crew minutes per service and lawn tier"
            draft={draft.minutes}
            onChange={(service, tier, v) => setDraft((d) => ({ ...d, minutes: { ...d.minutes, [service]: { ...d.minutes[service], [tier]: v } } }))}
            placeholderFor={() => "unknown"}
            suffix="min"
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {PROFIT_FIELDS.map((f) => (
              <NumberInput key={f.key} f={f} id={`cs-${f.key}`} value={draft.numbers[f.key]} onChange={(v) => setNumber(f.key, v)} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Score weights</CardTitle>
          <CardDescription>
            Each house earns 0 to 3 points for four things: time, lawn, a customer nearby, and the owner. A weight multiplies one of them (1 is normal,
            2 counts it double, 0 ignores it). Hot is 9 points or more out of 12.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SCORE_WEIGHT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`cs-weight-${f.key}`}>{f.label}</Label>
                <Input
                  id={`cs-weight-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  max={10}
                  value={draft.weights[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, weights: { ...d.weights, [f.key]: e.target.value } }))}
                />
                <p className="text-xs text-ink-muted">{f.hint}</p>
              </div>
            ))}
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
