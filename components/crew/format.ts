import type { AssignmentStatus, CrewJob, JobStatus } from "@/lib/db/types"
import { formatDayLabel, formatDuration, formatTimeRange, zonedToUtc } from "@/lib/scheduler"

/** Google Maps turn-by-turn directions to the job. */
export function directionsUrl(job: Pick<CrewJob, "address" | "lat" | "lng">): string | null {
  const dest = job.address?.trim() || (job.lat != null && job.lng != null ? `${job.lat},${job.lng}` : null)
  if (!dest) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}

/** "9:00–10:30am" or "Time TBD". */
export function jobTime(job: Pick<CrewJob, "start_at" | "end_at">): string {
  if (!job.start_at || !job.end_at) return "Time TBD"
  return formatTimeRange(new Date(job.start_at), new Date(job.end_at))
}

/** "Tue Oct 14" for a job, or "Not scheduled". */
export function jobDay(job: Pick<CrewJob, "start_at">): string {
  return job.start_at ? formatDayLabel(new Date(job.start_at)) : "Not scheduled"
}

/** "Tue Oct 14" for a local "YYYY-MM-DD" date. */
export function dateLabel(date: string): string {
  return formatDayLabel(zonedToUtc(date, "12:00"))
}

/** "09:00:00" / "13:30" → "9:00am" / "1:30pm". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const suffix = h >= 12 && h < 24 ? "pm" : "am"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`
}

export { formatDuration }

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive"

export const JOB_STATUS_LABEL: Record<JobStatus, { label: string; variant: BadgeVariant }> = {
  unscheduled: { label: "Unscheduled", variant: "outline" },
  proposed: { label: "Waiting on crew", variant: "outline" },
  crew_confirmed: { label: "Crew confirmed", variant: "secondary" },
  booked: { label: "Booked", variant: "success" },
  in_progress: { label: "In progress", variant: "warning" },
  done: { label: "Done", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, { label: string; variant: BadgeVariant }> = {
  offered: { label: "Offer — answer it", variant: "warning" },
  accepted: { label: "You're on it", variant: "success" },
  declined: { label: "Declined", variant: "outline" },
  swap_offered: { label: "Swap offer", variant: "warning" },
  drop_requested: { label: "Drop waiting for OK", variant: "warning" },
  dropped: { label: "Dropped", variant: "outline" },
}

export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0)

export const hoursLabel = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return `${v} h`
}
