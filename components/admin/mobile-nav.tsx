"use client"

import { Menu } from "lucide-react"
import * as React from "react"
import { usePathname } from "next/navigation"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { AdminNav } from "./nav"

/** Phone/tablet drawer with the same nav as the desktop sidebar. */
export function AdminMobileNav({
  pendingCount,
  children,
}: {
  pendingCount?: number
  /** Server-rendered extras for the drawer footer (fleet panel, sign out). */
  children?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const pathname = usePathname()

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-ink/[0.06]"
        >
          <Menu className="size-6" aria-hidden="true" />
          <span className="sr-only">Open menu</span>
          {pendingCount ? (
            <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand-green ring-2 ring-paper" aria-hidden="true" />
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-4 overflow-y-auto bg-paper p-4 pt-5">
        <SheetTitle className="text-base">Owner console</SheetTitle>
        <SheetDescription className="sr-only">Navigate the owner console</SheetDescription>
        <AdminNav pendingCount={pendingCount} onNavigate={() => setOpen(false)} />
        <div className="mt-auto space-y-2">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
