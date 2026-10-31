import {
  Activity,
  BadgeDollarSign,
  CalendarClock,
  CalendarDays,
  DoorOpen,
  House,
  Inbox,
  Megaphone,
  Receipt,
  Rocket,
  Users,
  UserRound,
  UserSearch,
  type LucideIcon,
} from "lucide-react"

export type AdminNavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "pending" }

/** Owner console navigation, in display order. */
export const adminNav: AdminNavItem[] = [
  { href: "/admin", label: "Home", icon: House, exact: true },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox, badge: "pending" },
  { href: "/admin/ads", label: "Ads", icon: Megaphone },
  { href: "/admin/leads", label: "Leads", icon: UserSearch },
  { href: "/admin/canvass", label: "Canvass", icon: DoorOpen },
  { href: "/admin/quotes", label: "Quotes", icon: Receipt },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/admin/availability", label: "Availability", icon: CalendarClock },
  { href: "/admin/employees", label: "Employees", icon: Users },
  { href: "/admin/customers", label: "Customers", icon: UserRound },
  { href: "/admin/money", label: "Money", icon: BadgeDollarSign },
  { href: "/admin/autopilot", label: "Autopilot", icon: Rocket },
  { href: "/admin/fleet", label: "Fleet", icon: Activity },
]
