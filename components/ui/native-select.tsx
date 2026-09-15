import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { fieldClasses } from "@/components/ui/input"

/**
 * A styled native <select>. On phones this opens the OS picker, which beats any custom dropdown
 * for speed and accessibility.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(fieldClasses, "h-12 cursor-pointer appearance-none rounded-full py-2 pr-12", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-5 top-1/2 size-5 -translate-y-1/2 text-ink"
        />
      </div>
    )
  }
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
