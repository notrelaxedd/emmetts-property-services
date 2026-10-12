import Link from "next/link"
import { Cpu } from "lucide-react"
import { cn } from "@/lib/utils"

export type FleetSummary = { online: number; total: number; aiSpend: number }

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })

/** Mini fleet status panel for the bottom of the sidebar. */
export function FleetPanel({ fleetSummary }: { fleetSummary?: FleetSummary }) {
  const { online, total, aiSpend } = fleetSummary ?? { online: 0, total: 0, aiSpend: 0 }
  const healthy = total > 0 && online === total
  const dot = total === 0 ? "bg-gray-panel" : healthy ? "bg-brand-green" : online > 0 ? "bg-amber-500" : "bg-destructive"
  return (
    <Link
      href="/admin/fleet"
      className="block rounded-lg border border-ink/10 bg-white p-3 transition-colors hover:border-ink/30"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Cpu className="size-3.5" aria-hidden="true" />
        Fleet status
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className={cn("size-2.5 rounded-full", dot)} aria-hidden="true" />
        <span className="tabular-nums">
          {online}/{total}
        </span>{" "}
        online
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        AI spend this month <span className="font-semibold tabular-nums text-ink">{usd.format(aiSpend)}</span>
      </p>
    </Link>
  )
}
