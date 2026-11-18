import type { AssignmentStatus, JobStatus, PaymentMethod } from "@/lib/db/types"
import type { JobMoney } from "@/lib/schedule/money"

export type ScheduleCrew = {
  id: string
  name: string
  initials: string
  status: AssignmentStatus
  /** When they answered the availability email / app offer. */
  respondedAt: string | null
  /** Whether the availability email went out. */
  notified: boolean
  /** Their hourly pay. */
  rate: number
}

/** A job as the week grid needs it. Times are pre-converted to business-timezone wall clock. */
export type ScheduleJob = {
  id: string
  status: JobStatus
  weatherHold: boolean
  /** Owner decision stands (taken off the calendar / card marked handled): the scheduler leaves it alone. */
  ownerHold: boolean
  /** The owners do this one themselves: no crew pay. */
  ownersWorking: boolean
  paid: boolean
  customerName: string
  phone: string | null
  email: string | null
  address: string | null
  services: string[]
  crew: ScheduleCrew[]
  crewSize: number
  estMinutes: number
  /** On-site hours (the slot's length, or the estimate when it has no slot). */
  hours: number
  /** Price, card fee (card payers only), crew pay and what you take home. */
  money: JobMoney
  /** Local "YYYY-MM-DD", or null when unscheduled. */
  date: string | null
  /** Minutes after local midnight. */
  startMin: number | null
  endMin: number | null
  /** "Tue Oct 14, 9:00–10:30am" */
  whenLabel: string | null
  scheduleReason: string | null
  quote: {
    id: string
    priceTotal: number
    feeTotal: number
    laborTotal: number
    /** Out-of-pocket job costs (rentals, seed, dump fees). */
    costTotal: number
    paymentMethod: PaymentMethod | null
    paidAt: string | null
    /** The quote still has a line waiting for your price (the job can't be confirmed yet). */
    needsOwner: boolean
  } | null
}

export type ScheduleDay = {
  date: string
  /** "Mon" */
  weekday: string
  /** "Oct 13" */
  label: string
  isToday: boolean
  /** Saved snow / mowing routes that day ("4:52–6:30am · 12 drives"), linking to their route page. */
  routes: { kind: "snow" | "mow"; label: string; href: string }[]
}

/** A request the quotes worker hasn't estimated yet (lead `new` / `quoting`). Not draggable yet. */
export type IncomingLead = {
  leadId: string
  customerName: string
  address: string | null
  services: string[]
  createdAt: string
}

/** An estimated quote with nothing priced yet, so no job exists to drag: it needs your price first. */
export type IncomingQuote = {
  quoteId: string
  customerName: string
  address: string | null
  services: string[]
  createdAt: string
}

export type Incoming = { estimating: IncomingLead[]; needsPrice: IncomingQuote[] }
