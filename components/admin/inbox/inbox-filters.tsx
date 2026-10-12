"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterChips } from "@/components/ui/filter-chips"

/** Filter chips that drive a `?<param>=` search param (server re-renders the list). */
export function UrlFilterChips({
  chips,
  value,
  param = "filter",
  defaultValue = "all",
  ariaLabel,
}: {
  chips: { value: string; label: string; count?: number }[]
  value: string
  param?: string
  defaultValue?: string
  ariaLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <FilterChips
      aria-label={ariaLabel}
      chips={chips}
      value={value}
      onChange={(v) => router.push(v === defaultValue ? pathname : `${pathname}?${param}=${encodeURIComponent(v)}`)}
    />
  )
}
