import Link from "next/link"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "all", href: "/admin/customers", label: "All customers" },
  { key: "log", href: "/admin/customers/log", label: "Price log" },
] as const

/** All customers / Price log switch at the top of the Customers pages. */
export function CustomersTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Customer views" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
            t.key === active ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-accent",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
