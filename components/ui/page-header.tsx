import * as React from "react"

import { cn } from "@/lib/utils"

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned slot for buttons / filters. */
  actions?: React.ReactNode
  /** Heading element. Pages use the default h1; a header inside a panel uses a lower level. */
  as?: "h1" | "h2" | "h3"
}

function PageHeader({ title, description, actions, as: Heading = "h1", className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)} {...props}>
      <div className="min-w-0">
        <Heading className="text-xl font-bold leading-tight tracking-tight text-ink sm:text-2xl">{title}</Heading>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export { PageHeader }
