"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function NavLink({
  href,
  exact = false,
  icon,
  badge,
  onNavigate,
  children,
}: {
  href: string
  /** Match only this exact path (used for the console home). */
  exact?: boolean
  icon?: React.ReactNode
  /** Count pill; hidden when 0 or undefined. */
  badge?: number
  onNavigate?: () => void
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-ink text-white" : "text-ink hover:bg-ink/[0.06]"
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {badge ? (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-xs font-bold leading-5 tabular-nums",
            active ? "bg-brand-green text-ink" : "bg-ink text-white"
          )}
          aria-label={`${badge} pending`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  )
}
