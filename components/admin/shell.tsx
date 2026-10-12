import type * as React from "react"
import { AdminBrand } from "./brand"
import { FleetPanel, type FleetSummary } from "./fleet-panel"
import { AdminMobileNav } from "./mobile-nav"
import { AdminNav } from "./nav"
import { SignOutButton } from "./sign-out-button"

/**
 * Owner console chrome: left sidebar on desktop, top bar + drawer on mobile.
 * Server component; the interactive bits (NavLink, drawer) are client islands.
 */
export function AdminShell({
  pendingCount = 0,
  fleetSummary,
  userName,
  children,
}: {
  pendingCount?: number
  fleetSummary?: FleetSummary
  userName?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-paper text-[0.9375rem] leading-normal text-ink-body lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only z-toast rounded-full bg-ink px-5 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r border-ink/10 bg-white/60 p-3 lg:flex">
        <div className="px-1 pt-1">
          <AdminBrand />
        </div>
        <AdminNav pendingCount={pendingCount} />
        <div className="mt-auto space-y-2">
          <FleetPanel fleetSummary={fleetSummary} />
          <SignOutButton name={userName} />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-sticky flex h-14 items-center justify-between border-b border-ink/10 bg-paper px-3 lg:hidden">
          <AdminBrand />
          <AdminMobileNav pendingCount={pendingCount}>
            <FleetPanel fleetSummary={fleetSummary} />
            <SignOutButton name={userName} />
          </AdminMobileNav>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] p-4 outline-none lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
