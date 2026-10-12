/**
 * Shapes shared between the inbox server page (`load-context.ts`) and the client cards.
 * Everything here must be plain, serializable data.
 */
import type {
  Ad,
  Approval,
  ApprovalKind,
  AssignmentStatus,
  Customer,
  CrewException,
  JobStatus,
  Message,
  Quote,
  QuoteItem,
} from "@/lib/db/types"

export const INBOX_FILTERS = ["all", "ads", "quotes", "custom", "appointments", "followups", "crew"] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

/** Which approval kinds each filter chip shows. `all` shows everything (including `ai_cap`). */
export const FILTER_KINDS: Record<Exclude<InboxFilter, "all">, ApprovalKind[]> = {
  ads: ["ad"],
  quotes: ["quote"],
  custom: ["custom_item"],
  appointments: ["booking", "weather_hold"],
  followups: ["followup"],
  crew: ["crew_change", "drop"],
}

export const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  ads: "Ads",
  quotes: "Quotes",
  custom: "Custom",
  appointments: "Appointments",
  followups: "Follow-ups",
  crew: "Crew changes",
}

export const KIND_LABELS: Record<ApprovalKind, string> = {
  ad: "Ad",
  quote: "Quote",
  custom_item: "Custom request",
  booking: "Appointment",
  followup: "Follow-up",
  crew_change: "Crew change",
  drop: "Drop",
  weather_hold: "Weather hold",
  ai_cap: "AI budget",
}

/** What rejecting does for each kind (shown in the reject dialog; see lib/ops/handlers/reject.ts). */
export const REJECT_EFFECTS: Record<ApprovalKind, string> = {
  ad: "The draft ad is deleted.",
  quote: "Nothing is sent; the quote is marked declined and the lead lost.",
  custom_item: "Nothing is sent and the item stays unpriced on the quote.",
  booking: "The crew is released and the job goes back to unscheduled.",
  followup: "The message is cancelled and never sent.",
  crew_change: "The request is declined.",
  drop: "They stay on the job.",
  weather_hold: "The jobs stay on the schedule.",
  ai_cap: "Nothing changes; AI drafting stays paused at the cap.",
}

export function isInboxFilter(v: unknown): v is InboxFilter {
  return typeof v === "string" && (INBOX_FILTERS as readonly string[]).includes(v)
}

/** A signed thumbnail for a private `lead-photos` object (url null if signing failed). */
export type Photo = { path: string; url: string | null }

export type CustomerSummary = Pick<
  Customer,
  "id" | "name" | "email" | "phone" | "address" | "lot_acres" | "tree_cover" | "email_opt_in" | "sms_opt_in"
>

export type JobSummary = {
  id: string
  status: JobStatus
  start_at: string | null
  end_at: string | null
  est_minutes: number
  customer_name: string | null
  address: string | null
}

export type MessageSummary = Pick<Message, "id" | "customer_id" | "kind" | "channel" | "subject" | "body" | "status">

type Ctx<K extends ApprovalKind, T> = { kind: K; error?: string } & T

export type QuoteContext = Ctx<"quote", { quote: Quote | null; customer: CustomerSummary | null; items: QuoteItem[] }>
export type CustomItemContext = Ctx<
  "custom_item",
  {
    item: QuoteItem | null
    quote: Quote | null
    customer: CustomerSummary | null
    customRequest: string | null
    photos: Photo[]
    /** The auto-quoted standard part of the same quote. */
    standardItems: QuoteItem[]
    standardTotal: number
  }
>
export type AdContext = Ctx<"ad", { ad: Ad | null }>
export type BookingContext = Ctx<
  "booking",
  {
    job: JobSummary | null
    scheduleReason: string | null
    customer: CustomerSummary | null
    /** `swapFrom` is set on `swap_offered` rows: the crew member handing the job over. */
    crew: { name: string; status: AssignmentStatus; swapFrom: string | null }[]
    services: string[]
  }
>
export type FollowupContext = Ctx<"followup", { messages: MessageSummary[]; recipients: { name: string; email: string | null }[] }>
export type CrewChangeContext = Ctx<
  "crew_change",
  { exception: CrewException | null; crewName: string | null; jobsHit: JobSummary[] }
>
export type DropContext = Ctx<
  "drop",
  { crewName: string | null; assignmentStatus: AssignmentStatus | null; job: JobSummary | null; hoursUntilStart: number | null }
>
export type WeatherHoldContext = Ctx<"weather_hold", { jobs: JobSummary[] }>
export type AiCapContext = Ctx<"ai_cap", { spend: number; cap: number | null }>

export type InboxContext =
  | QuoteContext
  | CustomItemContext
  | AdContext
  | BookingContext
  | FollowupContext
  | CrewChangeContext
  | DropContext
  | WeatherHoldContext
  | AiCapContext

export type InboxEntry = { approval: Approval; context: InboxContext }

/** Result of every admin server action in this area. */
export type ActionResult = { ok: true; message?: string; warning?: string } | { ok: false; error: string }
