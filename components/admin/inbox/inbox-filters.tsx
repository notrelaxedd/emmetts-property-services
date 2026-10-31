"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterChips } from "@/components/ui/filter-chips"

/**
 * Filter chips that drive a `?<param>=` search param (server re-renders the list). `basePath` is the
 * URL the param is added to (default: the current path with no other params), e.g. `/admin?stage=ads`
 * so the chips on the front page keep the open stage.
 */
export function UrlFilterChips({
  chips,
  value,
  param = "filter",
  defaultValue = "all",
  ariaLabel,
  basePath,
}: {
  chips: { value: string; label: string; count?: number }[]
  value: string
  param?: string
  defaultValue?: string
  ariaLabel?: string
  basePath?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const base = basePath ?? pathname
  const join = base.includes("?") ? "&" : "?"
  return (
    <FilterChips
      aria-label={ariaLabel}
      chips={chips}
      value={value}
      onChange={(v) =>
        router.push(v === defaultValue ? base : `${base}${join}${param}=${encodeURIComponent(v)}`, basePath ? { scroll: false } : undefined)
      }
    />
  )
}
