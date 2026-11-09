import Link from "next/link"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "customers", href: "/admin/snow", label: "Customers" },
  { key: "route", href: "/admin/snow/route", label: "Route" },
  { key: "bills", href: "/admin/snow/bills", label: "Bills" },
  { key: "log", href: "/admin/snow/log", label: "Push log" },
  { key: "settings", href: "/admin/snow/settings", label: "Settings" },
] as const

export type SnowTabKey = (typeof TABS)[number]["key"]

/** Customers / Route / Bills / Push log / Settings at the top of the Snow pages. */
export function SnowTabs({ active }: { active: SnowTabKey }) {
  return (
    <nav aria-label="Snow views" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
            t.key === active ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-accent",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
