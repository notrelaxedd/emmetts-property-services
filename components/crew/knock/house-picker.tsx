"use client"

import { ChevronLeft, ChevronRight, Loader2, LocateFixed, Search, X } from "lucide-react"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { NearbyParcel } from "@/lib/canvass/views"
import { cn } from "@/lib/utils"
import { OUTCOME_LABEL } from "./outcome-grid"
import type { GeoStatus } from "./use-geolocation"

const SWIPE_PX = 48

/** "Smith John" / "SMITH JOHN" → "Smith". Display only. */
export function greetingName(owner: string | null): string | null {
  const first = (owner ?? "").trim().split(/[\s,]+/)[0]
  if (!first || /^\d/.test(first)) return null
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

/** "2 days ago" / "today" / "3 weeks ago". */
export function agoLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return "just now"
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 14) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks < 8 ? `${weeks} weeks ago` : `${Math.floor(days / 30)} months ago`
}

export type HousePickerProps = {
  parcels: NearbyParcel[]
  index: number
  onIndexChange: (index: number) => void
  gpsStatus: GeoStatus
  loading: boolean
  onRetryGps: () => void
  onSearch: (q: string) => Promise<NearbyParcel[]>
  /** A search hit was picked: the logger adds it to the list and selects it. */
  onPickSearch: (parcel: NearbyParcel) => void
}

/** The selected house, big, with prev / next and a horizontal swipe to cycle by distance. */
export function HousePicker({ parcels, index, onIndexChange, gpsStatus, loading, onRetryGps, onSearch, onPickSearch }: HousePickerProps) {
  const parcel = parcels[index] ?? null
  const [searching, setSearching] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [hits, setHits] = React.useState<NearbyParcel[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const touchX = React.useRef<number | null>(null)

  const noGps = gpsStatus === "denied" || gpsStatus === "unsupported" || gpsStatus === "unavailable"
  React.useEffect(() => {
    if (noGps && parcels.length === 0) setSearching(true)
  }, [noGps, parcels.length])

  const prev = () => parcels.length && onIndexChange((index - 1 + parcels.length) % parcels.length)
  const next = () => parcels.length && onIndexChange((index + 1) % parcels.length)

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current
    touchX.current = null
    const end = e.changedTouches[0]?.clientX
    if (start === null || end === undefined) return
    const dx = end - start
    if (dx <= -SWIPE_PX) next()
    else if (dx >= SWIPE_PX) prev()
  }

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim().length < 2 || busy) return
    setBusy(true)
    try {
      setHits(await onSearch(q))
    } finally {
      setBusy(false)
    }
  }

  const name = parcel ? greetingName(parcel.owner_display) : null

  return (
    <section aria-label="House" className="flex flex-col gap-2">
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          "rounded-xl border bg-white p-4 shadow-sm",
          parcel?.do_not_knock ? "border-destructive/60" : "border-ink/10",
        )}
      >
        {parcel?.do_not_knock ? (
          <div className="mb-3 rounded-md bg-destructive px-3 py-2 text-sm font-bold text-white">
            Do not knock{parcel.window.reason && parcel.window.reason !== "Marked do not knock." ? `: ${parcel.window.reason}` : ""}
          </div>
        ) : null}

        {loading && !parcel ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Finding houses near you
          </div>
        ) : parcel ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {parcel.meters > 0 ? `${parcel.meters} m away` : "Selected"} · {index + 1} of {parcels.length}
            </p>
            <h2 className="text-2xl font-bold leading-tight text-ink">{parcel.address}</h2>
            {name && !parcel.owner_is_entity ? (
              <p className="text-base text-ink">Hi, is this the {name} place?</p>
            ) : parcel.owner_display ? (
              <p className="text-sm text-ink-muted">{parcel.owner_is_entity ? "Owned by " : ""}{parcel.owner_display}</p>
            ) : null}
            <p className="mt-1 text-sm text-ink" title={parcel.window.reason}>
              <span className="font-semibold">Best time:</span> {parcel.window.label}
            </p>
            <p className="text-sm text-ink">
              <span className="font-semibold">Quote:</span> {parcel.quoteLabel}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {parcel.isCustomer ? <Badge variant="success">Customer</Badge> : null}
              {parcel.owner_is_entity ? <Badge variant="outline">Landlord</Badge> : null}
              {parcel.lastKnock ? (
                <Badge variant="secondary">
                  {OUTCOME_LABEL[parcel.lastKnock.outcome]} · {agoLabel(parcel.lastKnock.knocked_at)}
                </Badge>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="min-h-16 text-sm text-ink-muted">
            {noGps ? "Location is off. Search the address below." : "No houses found within 250 m. Walk a bit or search the address."}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-12 text-base" onClick={prev} disabled={parcels.length < 2}>
            <ChevronLeft aria-hidden="true" />
            Prev
          </Button>
          <Button type="button" variant="outline" className="h-12 text-base" onClick={next} disabled={parcels.length < 2}>
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <LocateFixed className={cn("size-3.5", gpsStatus === "ok" ? "text-brand-green-dark" : "text-destructive")} aria-hidden="true" />
          {gpsStatus === "ok" ? "GPS on, swipe to change house" : gpsStatus === "asking" ? "Getting your location" : "GPS off"}
          {noGps ? (
            <button type="button" onClick={onRetryGps} className="ml-1 font-semibold underline underline-offset-2">
              Retry
            </button>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setSearching((s) => !s)}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-semibold text-ink hover:bg-ink/[0.06]"
        >
          {searching ? <X className="size-3.5" aria-hidden="true" /> : <Search className="size-3.5" aria-hidden="true" />}
          {searching ? "Close search" : "Search address"}
        </button>
      </div>

      {searching ? (
        <form onSubmit={runSearch} className="flex flex-col gap-2" noValidate>
          <div className="flex gap-2">
            <Input
              type="search"
              inputMode="search"
              placeholder="House number and street"
              className="h-12 text-base"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search address"
            />
            <Button type="submit" className="h-12 px-4" disabled={busy || q.trim().length < 2}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              <span className="sr-only">Search</span>
            </Button>
          </div>
          {hits ? (
            hits.length === 0 ? (
              <p className="px-1 text-sm text-ink-muted">No house matches that. Try just the house number.</p>
            ) : (
              <ul className="divide-y divide-ink/10 rounded-md border border-ink/10 bg-white">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPickSearch(h)
                        setSearching(false)
                        setHits(null)
                        setQ("")
                      }}
                      className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-ink/[0.04]"
                    >
                      <span>{h.address}</span>
                      {h.do_not_knock ? <Badge variant="destructive">Do not knock</Badge> : h.isCustomer ? <Badge variant="success">Customer</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
