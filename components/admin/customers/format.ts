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
