import { formatPhone } from "@/lib/ops/phone"
import { localDate } from "@/lib/scheduler/time"

export { formatPhone }

/** ISO instant -> local "YYYY-MM-DD" (business timezone), or "—". */
export function day(iso: string | null | undefined): string {
  return iso ? localDate(new Date(iso)) : "—"
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/** Suggestions for the price log's "What about" box. Anything else can be typed in. */
export const INTERACTION_CATEGORIES = [
  "Leaves",
  "Fall cleanup",
  "Snow plowing",
  "Lawn mowing",
  "Gutters",
  "Edging",
  "Mulch",
  "Brush / hauling",
] as const

export const INTERACTION_STATUSES = [
  { value: "open", label: "Waiting on them" },
  { value: "booked", label: "Booked" },
  { value: "passed", label: "Passed" },
] as const

export function interactionStatusLabel(s: string): string {
  return INTERACTION_STATUSES.find((x) => x.value === s)?.label ?? titleCase(s)
}
