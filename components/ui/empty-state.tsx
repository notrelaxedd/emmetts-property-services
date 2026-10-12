import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons / links rendered under the copy. */
  action?: React.ReactNode
}

function EmptyState({ icon: Icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-ink/25 bg-white/60 px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      {Icon ? (
        <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-brand-green/20 text-brand-green-dark">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
