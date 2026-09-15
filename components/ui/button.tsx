import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-out-quart disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90",
        outline: "rounded-md border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        ghost: "rounded-md hover:bg-accent hover:text-accent-foreground",
        link: "text-brand-green-dark underline-offset-4 hover:underline",
        // Flyer CTA: wide black pill, condensed caps, green ring on hover.
        cta: "rounded-full bg-ink font-display uppercase tracking-[0.03em] text-white hover:ring-4 hover:ring-brand-green active:scale-[0.98]",
        "cta-outline":
          "rounded-full border-2 border-ink bg-transparent font-display uppercase tracking-[0.03em] text-ink hover:ring-4 hover:ring-brand-green active:scale-[0.98]",
        // Header / call-bar accent: green fill with ink text (8:1).
        "cta-green":
          "rounded-full bg-brand-green font-display uppercase tracking-[0.03em] text-ink hover:bg-brand-green-dark hover:text-white active:scale-[0.98]",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8 text-sm",
        icon: "h-9 w-9",
        cta: "h-14 px-10 text-lg [&_svg]:size-5",
        "cta-sm": "h-11 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
