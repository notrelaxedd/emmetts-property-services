/**
 * Unknowns from docs/PLAN.md, kept as clearly marked config instead of invented values.
 * Business-level numbers (min price, drop notice, AI cap, partner) live in the `settings` table
 * and are edited from /admin; the integrations below are env-driven.
 */
export const opsConfig = {
  /** TODO [EMAIL PROVIDER — ask owner]. "log" prints to the console/journal instead of sending. */
  emailProvider: (process.env.EMAIL_PROVIDER ?? "log") as "log" | "resend" | "postmark" | "smtp",
  emailFrom: process.env.EMAIL_FROM ?? null, // TODO [sending domain]
  /** "none" = no server-side geocoding; address is free text. "census" is free and keyless. */
  geocoder: (process.env.GEOCODER ?? "none") as "none" | "census" | "google" | "mapbox" | "nominatim",
  /** "cuyahoga_gis" = county parcel layer at PARCEL_GIS_URL. "none" = owner enters lot size. */
  parcelSource: (process.env.PARCEL_SOURCE ?? "none") as "none" | "cuyahoga_gis" | "regrid",
  /** Spam protection for the quote form. Honeypot + rate limit always on; Turnstile when keys are set. */
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
  /** Browser-restricted Google Maps key (public by design). Enables Places address autocomplete on the quote form. */
  googleMapsBrowserKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
  /** Service-area centre used for weather + drive-time until settings.base_lat/lng are set. Rocky River, OH. */
  defaultBase: { lat: 41.4756, lng: -81.8396 },
  timezone: "America/New_York",
} as const;
