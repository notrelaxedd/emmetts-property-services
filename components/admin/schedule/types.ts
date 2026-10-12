import type { AssignmentStatus, JobStatus } from "@/lib/db/types"

export type ScheduleCrew = { id: string; name: string; initials: string; status: AssignmentStatus }

/** A job as the week grid needs it. Times are pre-converted to business-timezone wall clock. */
export type ScheduleJob = {
  id: string
  status: JobStatus
  weatherHold: boolean
  /** Owner decision stands (rejected slot / card marked handled): the scheduler leaves it alone. */
  ownerHold: boolean
  paid: boolean
  customerName: string
  address: string | null
  services: string[]
  crew: ScheduleCrew[]
  crewSize: number
  estMinutes: number
  /** Local "YYYY-MM-DD", or null when unscheduled. */
  date: string | null
  /** Minutes after local midnight. */
  startMin: number | null
  endMin: number | null
  /** "Tue Oct 14, 9:00–10:30am" */
  whenLabel: string | null
  scheduleReason: string | null
}

export type ScheduleDay = {
  date: string
  /** "Mon" */
  weekday: string
  /** "Oct 13" */
  label: string
  isToday: boolean
  /** Owner open hours, minutes after local midnight. */
  open: { startMin: number; endMin: number }[]
  /** Owner exception note for the day, if any. */
  note: string | null
  closed: boolean
}
