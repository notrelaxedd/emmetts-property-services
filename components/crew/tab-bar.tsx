"use client"

import { CalendarCheck, CalendarOff, Clock, DoorOpen, HandHelping, Wallet, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const tabs: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/crew", label: "Today", icon: CalendarCheck, exact: true },
  { href: "/crew/knock", label: "Knock", icon: DoorOpen },
  { href: "/crew/offers", label: "Offers", icon: HandHelping },
  { href: "/crew/hours", label: "Hours", icon: Clock },
  { href: "/crew/time-off", label: "Time off", icon: CalendarOff },
  { href: "/crew/pay", label: "Pay", icon: Wallet },
]

/** Sticky bottom tab bar. Constrained to the same 480px column as the page on desktop. */
export function CrewTabBar() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Crew"
      className="fixed bottom-0 left-1/2 z-sticky w-full max-w-[480px] -translate-x-1/2 border-t border-ink/10 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-6">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold leading-none transition-colors",
                  active ? "text-ink" : "text-ink-muted hover:text-ink"
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-green"
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" strokeWidth={active ? 2.5 : 2} />
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
