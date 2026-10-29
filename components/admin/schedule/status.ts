import type { AssignmentStatus, JobStatus } from "@/lib/db/types"

export const STATUS_LABEL: Record<JobStatus, string> = {
  unscheduled: "Needs a day",
  proposed: "On the calendar · call to confirm",
  crew_confirmed: "Crew free · call to confirm",
  booked: "Confirmed with customer",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
}

/** Short form for tight spots (badges, legend). */
export const STATUS_SHORT: Record<JobStatus, string> = {
  unscheduled: "Needs a day",
  proposed: "Call to confirm",
  crew_confirmed: "Crew free, call to confirm",
  booked: "Confirmed",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
}

/** Block colours by status (see the legend on the schedule page). */
export const STATUS_STYLE: Record<JobStatus, string> = {
  unscheduled: "border-2 border-dashed border-ink/30 bg-white text-ink",
  proposed: "border-2 border-amber-500 bg-amber-50 text-ink",
  crew_confirmed: "border-2 border-brand-green-dark bg-white text-ink",
  booked: "border border-brand-green-dark bg-brand-green text-ink",
  in_progress: "border border-blue-800 bg-blue-600 text-white",
  done: "border border-gray-mid bg-gray-light text-ink-muted",
  cancelled: "border border-dashed border-ink/30 bg-white/70 text-ink-muted line-through",
}

export const HATCH_STYLE = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(11,11,11,0.10) 0 5px, transparent 5px 10px)",
} as const

/** Jobs in these states can't be dragged / moved. */
export const LOCKED_STATUSES: readonly JobStatus[] = ["in_progress", "done", "cancelled"]

/** How a crew member's answer reads on the schedule. */
export const CREW_ANSWER: Record<AssignmentStatus, { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" }> = {
  offered: { label: "No answer yet", variant: "outline" },
  accepted: { label: "Available", variant: "success" },
  declined: { label: "Can't make it", variant: "destructive" },
  swap_offered: { label: "Swap offered", variant: "warning" },
  drop_requested: { label: "Wants to drop", variant: "warning" },
  dropped: { label: "Dropped", variant: "outline" },
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 || h === 24 ? "am" : "pm"}`
}

export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export function fmtPhone(digits: string): string {
  const d = digits.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return fmtPhone(d.slice(1))
  return digits
}

export function telHref(digits: string): string {
  const d = digits.replace(/\D/g, "")
  return `tel:${d.length === 10 ? `+1${d}` : d.startsWith("1") && d.length === 11 ? `+${d}` : digits}`
}
