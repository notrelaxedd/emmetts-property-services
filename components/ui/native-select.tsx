import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

/** A styled native `<select>`: works in plain server-action forms with no client JS. */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-white pl-3 pr-9 text-sm text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60"
      />
    </div>
  )
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
