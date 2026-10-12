/** Mon-first display order; values are JS weekdays (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
export const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "08:00" -> "8am", "13:30" -> "1:30pm" */
export function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`
}

export function prettyRange(start: string, end: string): string {
  return `${prettyTime(start)}–${prettyTime(end)}`
}

/** "2026-10-13" -> "Tue Oct 13" (timezone-free). */
export function prettyDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
}
