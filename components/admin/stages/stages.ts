import {
  Activity,
  BadgeDollarSign,
  CalendarDays,
  HardHat,
  Megaphone,
  Receipt,
  Rocket,
  UserRound,
  UserSearch,
  type LucideIcon,
} from "lucide-react"

/** The boxes on the console's front page (`/admin?stage=<key>`). */
export const STAGES = ["ads", "leads", "customers", "quotes", "schedule", "money", "crew", "fleet", "autopilot"] as const
export type StageKey = (typeof STAGES)[number]

export function isStage(v: unknown): v is StageKey {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v)
}

export type StageMeta = {
  name: string
  icon: LucideIcon
  /** Small label over the panel title. */
  step: string
  /** One line under the panel title. */
  description: string
  /** The existing full page for this stage. */
  fullPage: string
  /** "main" boxes sit in the row with arrows; "feeder" boxes point into one; "tool" boxes stand alone. */
  kind: "main" | "feeder" | "tool"
}

export const STAGE_META: Record<StageKey, StageMeta> = {
  ads: {
    name: "Ads",
    icon: Megaphone,
    step: "Stage 1",
    description: "Write ads, approve them, then post them on Facebook, Instagram or Nextdoor.",
    fullPage: "/admin/ads",
    kind: "main",
  },
  leads: {
    name: "Leads",
    icon: UserSearch,
    step: "Stage 2",
    description: "People who asked for a quote and are waiting on one. Tap a lead to see who they are.",
    fullPage: "/admin/leads",
    kind: "main",
  },
  customers: {
    name: "Customers",
    icon: UserRound,
    step: "Feeds leads",
    description: "Everyone on file. Add, edit or delete them, or rebook one as a new lead.",
    fullPage: "/admin/customers",
    kind: "feeder",
  },
  quotes: {
    name: "Quotes",
    icon: Receipt,
    step: "Stage 3",
    description: "Estimated quotes and the ones that need your price. Tap a quote to edit it.",
    fullPage: "/admin/quotes",
    kind: "main",
  },
  schedule: {
    name: "Schedule",
    icon: CalendarDays,
    step: "Stage 4",
    description: "Put jobs on the calendar, call the customer to confirm, then mark them done.",
    fullPage: "/admin/schedule",
    kind: "main",
  },
  money: {
    name: "Money",
    icon: BadgeDollarSign,
    step: "Stage 5",
    description: "Collect after the job by cash, check or an emailed card link.",
    fullPage: "/admin/money",
    kind: "main",
  },
  crew: {
    name: "Crew",
    icon: HardHat,
    step: "Feeds schedule",
    description: "Who can work this weekend, hours this week and pay owed.",
    fullPage: "/admin/employees",
    kind: "feeder",
  },
  fleet: {
    name: "Fleet",
    icon: Activity,
    step: "Tool",
    description: "The worker computers, their health and the task queue.",
    fullPage: "/admin/fleet",
    kind: "tool",
  },
  autopilot: {
    name: "Autopilot",
    icon: Rocket,
    step: "Tool",
    description: "Which kinds of actions can go out without your OK, plus business settings.",
    fullPage: "/admin/autopilot",
    kind: "tool",
  },
}

/** `/admin?stage=<key>` (plus `&id=` for one record, plus any extra params). */
export function stageHref(stage: StageKey, extra: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams({ stage })
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v)
  return `/admin?${params.toString()}`
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** "Jane Q Doe" → "JD". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}
