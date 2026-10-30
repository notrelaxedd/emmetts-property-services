"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { inspectCountyLayerAction, saveCanvassSettingsAction } from "@/app/admin/actions/canvass"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { DERIVED_FIELD_KEYS, PARCEL_FIELD_KEYS } from "@/lib/canvass/types"
import type { ParcelFieldKey, ParcelFieldMap, ParcelFieldMapPatch, ParcelFieldMapping } from "@/lib/canvass/types"

const AUTO = ""
const NONE = "__none__"

const KEY_LABELS: Record<ParcelFieldKey, string> = {
  parcel_id: "Parcel number (PIN)",
  owner: "Owner name",
  site_address: "Site address",
  site_city: "Site city",
  site_zip: "Site ZIP",
  mailing_address: "Mailing address",
  land_use: "Land-use code",
  acreage: "Acreage",
  shape_area: "Shape area",
  market_value: "Market value",
  year_built: "Year built",
  living_sqft: "Living area (sqft)",
  stories: "Stories",
  footprint_sqft: "Building footprint (sqft)",
  owner_occupied: "Owner occupied",
  street: "Street name",
}

/** What the select shows for a key: "" = auto pick, "__none__" = the owner says the layer has no such field. */
function selectValueOf(m: ParcelFieldMapping | undefined): string {
  if (!m || m.source !== "manual") return AUTO
  return m.field ?? NONE
}

/** The mapping a select value stands for, keeping the key's candidates. */
export function mappingFor(value: string, current: ParcelFieldMapping | undefined): ParcelFieldMapping {
  const candidates = current?.candidates ?? []
  if (value === AUTO) return { field: candidates[0] ?? null, source: candidates.length > 0 ? "auto" : "missing", candidates }
  if (value === NONE) return { field: null, source: "manual", candidates }
  return { field: value, source: "manual", candidates }
}

function missingKeys(map: ParcelFieldMap): ParcelFieldKey[] {
  return PARCEL_FIELD_KEYS.filter((k) => !DERIVED_FIELD_KEYS.includes(k) && !map[k]?.field)
}

function fetchedLabel(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/**
 * County field map: one row per parcel field the pull reads, a select of the layer's real fields, and
 * "Refresh from county" which re-reads the layer metadata and re-runs the auto match (manual picks are kept).
 */
export function FieldMapForm({ initial }: { initial: ParcelFieldMap }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [map, setMap] = React.useState<ParcelFieldMap>(initial)
  const [choices, setChoices] = React.useState<Partial<Record<ParcelFieldKey, string>>>({})

  const layerFields = map.layer_fields ?? []
  const fetched = !!map.fetched_at
  const dirtyKeys = PARCEL_FIELD_KEYS.filter((k) => choices[k] !== undefined && choices[k] !== selectValueOf(map[k]))
  const missing = missingKeys(map)

  const refresh = () => {
    startTransition(async () => {
      const r = await inspectCountyLayerAction()
      if (!r.ok) {
        toast({ title: "Couldn't reach the county layer", description: r.reason, variant: "destructive" })
        return
      }
      setMap(r.fieldMap)
      setChoices({})
      toast({ title: r.message, variant: r.missing.length > 0 ? "default" : "success" })
      router.refresh()
    })
  }

  const save = () => {
    if (dirtyKeys.length === 0) return
    const patch: ParcelFieldMapPatch = {}
    for (const k of dirtyKeys) patch[k] = mappingFor(choices[k] ?? AUTO, map[k])
    startTransition(async () => {
      const r = await saveCanvassSettingsAction({ parcel_field_map: patch })
      if (!r.ok) {
        toast({ title: "Couldn't save the field map", description: r.reason, variant: "destructive" })
        return
      }
      setMap((m) => ({ ...m, ...patch }))
      setChoices({})
      toast({ title: `Saved ${dirtyKeys.length} mapping(s).`, variant: "success" })
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>County field map</CardTitle>
        <CardDescription>
          Mappings are discovered from the county parcel layer at runtime by matching its field names and aliases, and any of
          them can be overridden here. Press Refresh after the county changes its layer; your manual picks are kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={refresh}>
            <RefreshCw className={pending ? "animate-spin" : undefined} /> Refresh from county
          </Button>
          <span className="text-sm text-ink-muted">
            {fetched
              ? `Layer: ${map.layer_name || "(unnamed)"}, ${layerFields.length} field(s), read ${fetchedLabel(map.fetched_at) ?? ""}`
              : "Not read yet. Refresh to discover the layer's fields."}
          </span>
        </div>

        {fetched && missing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-ink-muted">No match yet for:</span>
            {missing.map((k) => (
              <Badge key={k} variant="warning">
                {KEY_LABELS[k]}
              </Badge>
            ))}
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parcel field</TableHead>
              <TableHead>Layer field</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PARCEL_FIELD_KEYS.map((k) => {
              const m = map[k]
              const auto = m?.candidates?.[0] ?? null
              const value = choices[k] ?? selectValueOf(m)
              const options = layerFields.length > 0 ? layerFields.map((f) => ({ name: f.name, alias: f.alias })) : (m?.candidates ?? []).map((c) => ({ name: c, alias: "" }))
              // A manual pick that is not in the list (layer changed) still needs to show.
              if (value !== AUTO && value !== NONE && !options.some((o) => o.name === value)) options.push({ name: value, alias: "" })
              const derived = DERIVED_FIELD_KEYS.includes(k)
              const missingHere = !m?.field && !derived
              return (
                <TableRow key={k}>
                  <TableCell className="align-top">
                    <div className="font-medium text-ink">{KEY_LABELS[k]}</div>
                    <div className="text-xs text-ink-muted">
                      {k}
                      {derived ? " (derived from the address when unmapped)" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[14rem] align-top">
                    <NativeSelect
                      aria-label={`${KEY_LABELS[k]} layer field`}
                      value={value}
                      disabled={pending || !fetched}
                      onChange={(e) => setChoices((c) => ({ ...c, [k]: e.target.value }))}
                    >
                      <option value={AUTO}>{auto ? `(auto) ${auto}` : "(auto) no match"}</option>
                      <option value={NONE}>(none)</option>
                      {options.map((o) => (
                        <option key={o.name} value={o.name}>
                          {o.alias && o.alias !== o.name ? `${o.name} (${o.alias})` : o.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="hidden align-top sm:table-cell">
                    {missingHere && fetched ? (
                      <Badge variant="warning">Missing</Badge>
                    ) : m?.source === "manual" ? (
                      <Badge variant="outline">Manual</Badge>
                    ) : m?.field ? (
                      <Badge variant="success">Auto</Badge>
                    ) : (
                      <span className="text-xs text-ink-muted">{derived ? "Derived" : "Not read"}</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending || dirtyKeys.length === 0} onClick={save}>
            {pending ? "Saving…" : dirtyKeys.length > 0 ? `Save ${dirtyKeys.length} mapping(s)` : "Save mappings"}
          </Button>
          {dirtyKeys.length > 0 ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setChoices({})}>
              Discard changes
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
