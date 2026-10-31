import Link from "next/link"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "map", href: "/admin/canvass", label: "Map" },
  { key: "plan", href: "/admin/canvass/plan", label: "Plan" },
  { key: "hangers", href: "/admin/canvass/hangers", label: "Hangers" },
  { key: "stats", href: "/admin/canvass/stats", label: "Stats" },
  { key: "settings", href: "/admin/canvass/settings", label: "Settings" },
] as const

export type CanvassTabKey = (typeof TABS)[number]["key"]

/** Map / Plan / Hangers / Stats / Settings switch at the top of the Canvass pages. */
export function CanvassTabs({ active }: { active: CanvassTabKey }) {
  return (
    <nav aria-label="Canvass views" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
