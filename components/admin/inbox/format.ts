/**
 * Display helpers shared by the inbox, ads, leads and quotes pages. Pure (no server-only), and every
 * date is formatted in the business timezone so server and client renders agree.
 */
import { BUSINESS_TZ } from "@/lib/scheduler/time"

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })

/** "$90" for whole dollars, "$12.34" otherwise, "—" for null. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return Number.isInteger(n) ? usd0.format(n) : usd2.format(n)
}

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
})
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, weekday: "short", month: "short", day: "numeric" })
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" })

/** "Tue, Oct 14, 9:00 AM" */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return dateTimeFmt.format(new Date(iso))
}

/** "Oct 14, 2026" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return dateFmt.format(new Date(iso))
}

/** A `date` column ("2026-10-14") rendered without timezone drift: "Tue, Oct 14". */
export function calendarDate(ymd: string | null | undefined): string {
  if (!ymd) return "—"
  // Noon UTC is the same calendar day in every US timezone.
  return dayFmt.format(new Date(`${ymd}T12:00:00Z`))
}

/** "Tue, Oct 14, 9:00 AM – 10:30 AM" */
export function slot(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "Not scheduled"
  if (!end) return dateTime(start)
  return `${dayFmt.format(new Date(start))}, ${timeFmt.format(new Date(start))} – ${timeFmt.format(new Date(end))}`
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—"
  const diff = Math.max(0, now - Date.parse(iso))
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** "2.5 h" */
export function hours(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `${Math.round(n * 100) / 100} h`
}

/** Human label for snake_case enum values: "needs_owner" -> "Needs owner". */
export function label(value: string | null | undefined): string {
  if (!value) return "—"
  const s = value.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}
