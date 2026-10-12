import type { AutopilotInput } from "@/app/admin/actions/autopilot"

export type AutopilotKind = keyof AutopilotInput

/**
 * The autopilot switches shown on /admin/autopilot. `custom_item` is deliberately absent: a custom
 * request always needs the owner's price (its cards are raised with `createApproval`, never
 * autopiloted), so a switch for it would do nothing. Its stored rule is left untouched on save.
 */
export const AUTOPILOT_KINDS: { kind: Exclude<AutopilotKind, "custom_item">; title: string; skips: string }[] = [
  { kind: "ad", title: "Ads", skips: "New ad drafts are approved without your review, ready to post." },
  { kind: "quote", title: "Quotes", skips: "Standard quotes go straight to the customer with a Stripe pay link." },
  { kind: "booking", title: "Appointments", skips: "Once every crew member accepts, the job is booked and the customer is confirmed." },
  { kind: "followup", title: "Follow-ups", skips: "Review requests, day-before reminders and snow-plan emails send on their own." },
  {
    kind: "crew_change",
    title: "Crew time off",
    skips: "Time off that hits a booked job or falls inside the notice window is approved automatically.",
  },
  { kind: "drop", title: "Crew drops", skips: "Crew can drop a job inside the notice window; the scheduler looks for cover." },
  { kind: "weather_hold", title: "Weather holds", skips: "Rain and snow holds from the weather watch are applied without asking." },
]

export const HIDDEN_AUTOPILOT_NOTE =
  "Custom requests have no autopilot: you always set the price (or refer / decline) yourself."
