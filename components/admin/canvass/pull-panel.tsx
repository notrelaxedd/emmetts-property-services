"use client"

/**
 * Draw an area on the map and pull its parcels from the county. Owns the pull state (pending, last result) and
 * renders the result: counts, warnings, and any field keys the county layer did not map (with a link to Settings).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { pullParcelsAction } from "@/app/admin/actions/canvass"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import type { LatLng, MapParcel, ParcelRow } from "@/lib/canvass/admin-rows"
import type { GeoPolygon, ParcelFieldKey } from "@/lib/canvass/types"
import { AreaMapClient } from "./area-map-client"

type PullOk = Extract<Awaited<ReturnType<typeof pullParcelsAction>>, { ok: true }>

const FIELD_KEY_LABELS: Partial<Record<ParcelFieldKey, string>> = {
  parcel_id: "parcel id",
  owner: "owner",
  site_address: "site address",
  site_city: "city",
  site_zip: "zip",
  mailing_address: "mailing address",
  land_use: "land use",
  acreage: "acreage",
  shape_area: "shape area",
  market_value: "market value",
  year_built: "year built",
  living_sqft: "living sqft",
  stories: "stories",
  footprint_sqft: "footprint sqft",
  owner_occupied: "owner occupied",
  street: "street",
}

export function PullPanel({ shapes, rows, center }: { shapes: MapParcel[]; rows: ParcelRow[]; center: LatLng }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [result, setResult] = React.useState<PullOk | null>(null)

  const pull = (polygon: GeoPolygon) => {
    setResult(null)
    startTransition(async () => {
      const r = await pullParcelsAction(polygon)
      if (!r.ok) {
        toast({ title: "Couldn't pull parcels", description: r.reason, variant: "destructive" })
        return
      }
      setResult(r)
      const extras = [
        r.warnings.length > 0 ? `${r.warnings.length} warning(s)` : null,
        r.missing.length > 0 ? `${r.missing.length} field(s) not mapped` : null,
      ].filter(Boolean)
      toast({ title: r.message, description: extras.length > 0 ? extras.join(", ") : undefined, variant: "success", duration: 8000 })
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {pending ? (
        <p role="status" className="rounded-md border border-brand-green-dark/30 bg-brand-green/10 px-3 py-2 text-sm text-ink">
          Pulling parcels from the county, then block groups and Census data. This can take a minute for a big area.
        </p>
      ) : null}
      <AreaMapClient shapes={shapes} rows={rows} center={center} pulling={pending} onPull={pull} />
      {result ? <PullResult result={result} onDismiss={() => setResult(null)} /> : null}
    </div>
  )
}

function PullResult({ result, onDismiss }: { result: PullOk; onDismiss: () => void }) {
  const counts: [string, number][] = [
    ["Pulled", result.pulled],
    ["Residential", result.residential],
    ["New", result.inserted],
    ["Refreshed", result.updated],
    ["Block groups", result.blockGroupsAssigned],
    ["ACS fetched", result.acsFetched],
  ]
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <CheckCircle2 className="size-4 text-brand-green-dark" aria-hidden="true" /> Pull finished
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {counts.map(([label, n]) => (
          <div key={label} className="rounded-md bg-gray-light/60 px-2 py-1.5">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-semibold tabular-nums text-ink">{n}</dd>
          </div>
        ))}
      </dl>
      {result.missing.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4" aria-hidden="true" /> County fields not mapped
          </p>
          <p className="mt-1">
            {result.missing.map((k) => FIELD_KEY_LABELS[k] ?? k).join(", ")}. Those columns stay empty until you pick the matching layer field in{" "}
            <Link href="/admin/canvass/settings" className="font-medium underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        </div>
      ) : null}
      {result.warnings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
