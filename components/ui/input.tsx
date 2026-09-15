import * as React from "react"

import { cn } from "@/lib/utils"

/** Shared field styling: pill-shaped, 48px tall (thumb-friendly), 3:1 border, red border when invalid. */
export const fieldClasses =
  "flex w-full border-2 border-input bg-white px-5 text-base text-ink transition-colors placeholder:text-ink-muted hover:border-ink focus-visible:border-ink aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(fieldClasses, "h-12 rounded-full py-2", className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
