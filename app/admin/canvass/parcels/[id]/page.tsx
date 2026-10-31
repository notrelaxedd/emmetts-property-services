import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, DoorOpen, Home } from "lucide-react"
import { ParcelDetailForm } from "@/components/admin/canvass/parcel-detail-form"
import { QuoteCard } from "@/components/admin/canvass/quote-card"
import { PointsPopover } from "@/components/admin/canvass/points-popover"
import { TraceMapClient } from "@/components/admin/canvass/trace-map-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { formatMoney, formatSqft, HOME_PATTERN_LABELS, outcomeLabel } from "@/lib/canvass/admin-rows"
import { loadParcelDetail } from "@/lib/canvass/load"
import { incomeLabel, occupancyLabel } from "@/lib/canvass/owner-view"
import type { ParcelDetailResult } from "@/lib/canvass/views"
import { opsConfig } from "@/lib/config"
import { formatDayLabel, localDate, localTime } from "@/lib/scheduler/time"
import { getSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Parcel" }

const UUID = /^[0-9a-f-]{36}$/i

function Fact({ label, value, note, wide }: { label: string; value: string; note?: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
      {note ? <dd className="text-xs text-ink-muted">{note}</dd> : null}
    </div>
  )
}

/** "$45" for a quote with one price, "$45 to $60" for an older knock that stored a range. */
function quotedText(low: number, high: number): string {
  const l = Math.round(low)
  const h = Math.round(high)
  return l === h ? `$${l}` : `$${l} to $${h}`
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
  // What the homeowner or the crew told us, as plain text.
  const homeownerSaid = parcel.callback_window?.trim() || null
  const crewNoted = parcel.home_pattern ? HOME_PATTERN_LABELS[parcel.home_pattern] : null
  const center: [number, number] =
    parcel.centroid_lat !== null && parcel.centroid_lng !== null ? [parcel.centroid_lat, parcel.centroid_lng] : [opsConfig.defaultBase.lat, opsConfig.defaultBase.lng]

  return (
    <div className="space-y-4">
      <PageHeader
        title={parcel.fullAddress}
        description={parcel.owner_display ?? "Owner unknown"}
        actions={
          <>
            <PointsPopover
              label={parcel.simple.label}
              points={parcel.simple.points}
              breakdown={parcel.simple.breakdown}
              reason={parcel.simple.reasons.join(" · ")}
              weights={settings.score_weights}
            />
            <Button asChild variant="outline">
              <Link href="/admin/canvass">
                <ArrowLeft /> Back to map
              </Link>
            </Button>
          </>
        }
      />
      {/* Badges render a <div>, so they sit under the header rather than inside its description <p>. */}
      {parcel.owner_is_entity || parcel.isCustomer || parcel.do_not_knock ? (
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          {parcel.owner_is_entity ? <Badge variant="outline">Entity owner</Badge> : null}
          {parcel.isCustomer ? <Badge variant="secondary">Customer</Badge> : null}
          {parcel.do_not_knock ? <Badge variant="destructive">Do not knock</Badge> : null}
        </div>
      ) : null}

      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Market value" value={formatMoney(parcel.market_value) || "?"} />
          <Fact
            label="Lot"
            value={parcel.lot_sqft !== null ? `${formatSqft(parcel.lot_sqft)} sqft` : "?"}
            note={turfSqft !== null ? `Turf about ${formatSqft(turfSqft)} sqft (${parcel.turfSource === "traced" ? "traced" : "estimated"})` : "Turf unknown"}
          />
          <Fact label="Year built" value={parcel.year_built ? String(parcel.year_built) : "?"} />
          <Fact label="Living sqft" value={parcel.living_sqft !== null ? formatSqft(parcel.living_sqft) : "?"} />
          <Fact label="Occupancy" value={occupancyLabel(parcel.owner_occupied, parcel.owner_is_entity)} />
          <Fact label="Neighborhood median income (Census area, not this household)" value={incomeLabel(parcel.medianIncome)} wide />
          <Fact
            label="Last knock"
            value={parcel.lastKnock ? `${localDate(new Date(parcel.lastKnock.knocked_at))}, ${outcomeLabel(parcel.lastKnock.outcome)}` : "Not knocked yet"}
            note={parcel.lastKnock ? `by ${parcel.lastKnock.knocker_name}` : undefined}
          />
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          Parcel {parcel.parcel_id}
          {parcel.land_use ? ` · Land use ${parcel.land_use}` : ""}
          {parcel.block_group_geoid ? ` · Block group ${parcel.block_group_geoid}` : ""}
        </p>
      </Card>

      <div className={homeownerSaid || crewNoted ? "grid gap-4 lg:grid-cols-2" : undefined}>
        {homeownerSaid || crewNoted ? (
          <Card className="space-y-1 p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Heard at the door</p>
            {homeownerSaid ? (
              <p className="text-ink">
                Homeowner said: <span className="font-medium">{homeownerSaid}</span>
              </p>
            ) : null}
            {crewNoted ? (
              <p className="text-ink">
                Crew noted: <span className="font-medium">{crewNoted}</span>
              </p>
            ) : null}
          </Card>
        ) : null}
        <QuoteCard
          season={season}
          quote={parcel.quote}
          quotes={parcel.quotes}
          turfSqft={turfSqft}
          turfSource={parcel.turfSource}
          settings={{ hardscape_pct: settings.hardscape_pct, crew_size: settings.crew_size, pay_rate: settings.pay_rate }}
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
          <EmptyState icon={DoorOpen} title="Not knocked yet" description="Knocks the crew logs from Walk show up here with the outcome, pitch and weather." />
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
                      {k.quote_low !== null && k.quote_high !== null ? <span>Quoted {quotedText(k.quote_low, k.quote_high)}</span> : null}
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
