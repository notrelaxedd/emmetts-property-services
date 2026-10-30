"use client"

import * as React from "react"

export type GeoStatus = "idle" | "asking" | "ok" | "denied" | "unavailable" | "unsupported"

export type GeoPosition = { lat: number; lng: number; accuracy: number; at: number }

export type Geolocation = {
  position: GeoPosition | null
  status: GeoStatus
  /** Ask again (after a denial the browser may need the site setting changed). */
  retry: () => void
}

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 8_000, maximumAge: 15_000 }

/**
 * One fix on mount (high accuracy, 8 s timeout), then `watchPosition` while the screen is open so the
 * selected house follows the crew member down the street. Never throws; `status` says what happened.
 */
export function useGeolocation(enabled = true): Geolocation {
  const [position, setPosition] = React.useState<GeoPosition | null>(null)
  const [status, setStatus] = React.useState<GeoStatus>("idle")
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled) return
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported")
      return
    }
    let cancelled = false
    let watchId: number | null = null
    setStatus("asking")

    const onFix = (p: GeolocationPosition) => {
      if (cancelled) return
      setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() })
      setStatus("ok")
    }
    const onError = (e: GeolocationPositionError) => {
      if (cancelled) return
      setStatus(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable")
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          onFix(p)
          try {
            watchId = navigator.geolocation.watchPosition(onFix, () => {}, OPTIONS)
          } catch {
            watchId = null
          }
        },
        onError,
        OPTIONS,
      )
    } catch {
      setStatus("unavailable")
    }

    return () => {
      cancelled = true
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId)
        } catch {
          // nothing to clean up
        }
      }
    }
  }, [enabled, attempt])

  const retry = React.useCallback(() => setAttempt((n) => n + 1), [])
  return { position, status, retry }
}
