import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, DoorOpen, Home } from "lucide-react"
import { ParcelDetailForm } from "@/components/admin/canvass/parcel-detail-form"
import { QuoteCard } from "@/components/admin/canvass/quote-card"
import { ScorePopover } from "@/components/admin/canvass/score-popover"
import { TraceMapClient } from "@/components/admin/canvass/trace-map-client"
import { WindowBadge } from "@/components/admin/canvass/window-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { formatMoney, formatSqft, HOME_PATTERN_LABELS, outcomeLabel, yesNo } from "@/lib/canvass/admin-rows"
import { loadParcelDetail } from "@/lib/canvass/load"
import type { ParcelDetailResult } from "@/lib/canvass/views"
import { opsConfig } from "@/lib/config"
import { formatDayLabel, localTime } from "@/lib/scheduler/time"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Parcel" }

const UUID = /^[0-9a-f-]{36}$/i

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  )
}

export default async function ParcelDetailPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!UUID.test(params.id)) notFound()

  if (!getSupabaseAdmin()) {
    return (
      <div className="space-y-4">
        <PageHeader title="Parcel" />
        <EmptyState icon={Home} title="Not connected" description="Supabase isn't configured yet, so parcels can't be loaded." />
      </div>
    )
  }

  let data: ParcelDetailResult | null = null
  let error: string | null = null
  try {
    data = await loadParcelDetail(requireSupabaseAdmin(), params.id)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (!error && !data) notFound()

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Parcel" />
        <EmptyState icon={Home} title="Couldn't load this parcel" description={error ?? undefined} />
      </div>
    )
  }

  const { parcel, knocks, settings, season } = data
  const turfSqft = parcel.turf_sqft_traced ?? parcel.turf_sqft_est
  const center: [number, number] =
    parcel.centroid_lat !== null && parcel.centroid_lng !== null ? [parcel.centroid_lat, parcel.centroid_lng] : [opsConfig.defaultBase.lat, opsConfig.defaultBase.lng]

  return (
    <div className="space-y-4">
      <PageHeader
        title={parcel.address}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{parcel.owner_display ?? "Owner unknown"}</span>
            {parcel.owner_is_entity ? <Badge variant="outline">Entity owner</Badge> : null}
            {parcel.isCustomer ? <Badge variant="secondary">Customer</Badge> : null}
            {parcel.do_not_knock ? <Badge variant="destructive">Do not knock</Badge> : null}
          </span>
        }
        actions={
          <>
            <ScorePopover score={parcel.score} breakdown={parcel.breakdown} quintile={parcel.quintile} />
            <Button asChild variant="outline">
              <Link href="/admin/canvass">
                <ArrowLeft /> Back to map
              </Link>
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Parcel id" value={parcel.parcel_id} />
          <Fact label="Land use" value={parcel.land_use ?? "?"} />
          <Fact label="Year built" value={parcel.year_built ? String(parcel.year_built) : "?"} />
          <Fact label="Market value" value={formatMoney(parcel.market_value) || "?"} />
          <Fact label="Lot" value={parcel.lot_sqft !== null ? `${formatSqft(parcel.lot_sqft)} sqft` : "?"} />
          <Fact label="Living area" value={parcel.living_sqft !== null ? `${formatSqft(parcel.living_sqft)} sqft` : "?"} />
          <Fact label="Owner occupied" value={yesNo(parcel.owner_occupied)} />
          <Fact label="Home pattern" value={parcel.home_pattern ? HOME_PATTERN_LABELS[parcel.home_pattern] : "Not set"} />
        </dl>
        {parcel.city || parcel.zip || parcel.street ? (
          <p className="mt-3 text-xs text-ink-muted">
            {[parcel.street, parcel.city, parcel.zip].filter(Boolean).join(", ")}
            {parcel.block_group_geoid ? ` · Block group ${parcel.block_group_geoid}` : ""}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <WindowBadge window={parcel.window} />
        <QuoteCard
          season={season}
          quote={parcel.quote}
          quotes={parcel.quotes}
          turfSqft={turfSqft}
          turfSource={parcel.turfSource}
          settings={{ rate_per_1000_sqft: settings.rate_per_1000_sqft, min_charge: settings.min_charge, hardscape_pct: settings.hardscape_pct }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-2" aria-labelledby="trace-heading">
          <h2 id="trace-heading" className="text-base font-semibold text-ink">
            Lawn
          </h2>
          <TraceMapClient parcelId={parcel.id} geom={parcel.geom} center={center} initialTrace={parcel.turf_geom} estimateSqft={parcel.turf_sqft_est} />
        </section>
        <section className="space-y-2" aria-labelledby="edit-heading">
          <h2 id="edit-heading" className="text-base font-semibold text-ink">
            What we know
          </h2>
          <Card className="p-4">
            <ParcelDetailForm
              id={parcel.id}
              initial={{
                callback_window: parcel.callback_window,
                home_pattern: parcel.home_pattern,
                do_not_knock: parcel.do_not_knock,
                do_not_knock_reason: parcel.do_not_knock_reason,
              }}
            />
          </Card>
        </section>
      </div>

      <section className="space-y-2" aria-labelledby="knocks-heading">
        <h2 id="knocks-heading" className="text-base font-semibold text-ink">
          Knocks{knocks.length > 0 ? ` (${knocks.length})` : ""}
        </h2>
        {knocks.length === 0 ? (
          <EmptyState icon={DoorOpen} title="Not knocked yet" description="Knocks the crew logs from the Knock tab show up here with the outcome, pitch and weather." />
        ) : (
          <Card className="divide-y divide-ink/10">
            {knocks.map((k) => {
              const when = new Date(k.knocked_at)
              return (
                <div key={k.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:gap-4">
                  <div className="shrink-0 whitespace-nowrap tabular-nums text-ink-muted sm:w-36">
                    {formatDayLabel(when)} {localTime(when)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium text-ink">
                      {outcomeLabel(k.outcome)}
                      <span className="ml-2 text-xs font-normal text-ink-muted">by {k.knocker_name}</span>
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
                      {k.pitch_name ? <span>Pitch: {k.pitch_name}</span> : null}
                      {k.weather?.label ? <span>{k.weather.label}{typeof k.weather.temp_f === "number" ? `, ${Math.round(k.weather.temp_f)}F` : ""}</span> : null}
                      {k.quote_low !== null && k.quote_high !== null ? <span>Quoted ${Math.round(k.quote_low)}–${Math.round(k.quote_high)}</span> : null}
                      {k.callback_window ? <span>Said: {k.callback_window}</span> : null}
                      {k.home_pattern ? <span>{HOME_PATTERN_LABELS[k.home_pattern]}</span> : null}
                    </p>
                    {k.notes ? <p className="whitespace-pre-line text-ink-body">{k.notes}</p> : null}
                  </div>
                </div>
              )
            })}
          </Card>
        )}
      </section>
    </div>
  )
}
