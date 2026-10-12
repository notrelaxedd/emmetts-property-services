import * as React from "react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  value: React.ReactNode
  /** Change text, e.g. "+12%" or "-$40". */
  delta?: React.ReactNode
  /** Whether the change is good, bad or neutral. Defaults to "neutral". */
  deltaTone?: "up" | "down" | "neutral"
  /** Small line under the value. */
  hint?: React.ReactNode
}

function Stat({ label, value, delta, deltaTone = "neutral", hint, className, ...props }: StatProps) {
  return (
    <div className={cn("rounded-lg border border-ink/10 bg-white p-4 shadow-sm", className)} {...props}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-ink sm:text-3xl">{value}</p>
      {delta || hint ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs">
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-semibold",
                deltaTone === "up" && "text-brand-green-dark",
                deltaTone === "down" && "text-destructive",
                deltaTone === "neutral" && "text-ink-muted"
              )}
            >
              {deltaTone === "up" ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : null}
              {deltaTone === "down" ? <ArrowDownRight className="size-3.5" aria-hidden="true" /> : null}
              {delta}
            </span>
          ) : null}
          {hint ? <span className="text-ink-muted">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export { Stat }
