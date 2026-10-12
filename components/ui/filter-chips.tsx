"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface FilterChip {
  value: string
  label: React.ReactNode
  /** Optional count shown in a small pill. */
  count?: number
}

export interface FilterChipsProps {
  chips: FilterChip[]
  /** Controlled value (single select). */
  value: string
  onChange: (value: string) => void
  className?: string
  "aria-label"?: string
}

/** A horizontally scrollable row of toggle chips. Single-select, controlled. */
function FilterChips({ chips, value, onChange, className, "aria-label": ariaLabel = "Filter" }: FilterChipsProps) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1", className)}>
      {chips.map((chip) => {
        const active = chip.value === value
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.value)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
              active ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-accent"
            )}
          >
            {chip.label}
            {typeof chip.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  active ? "bg-brand-green text-ink" : "bg-gray-light text-ink"
                )}
              >
                {chip.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export { FilterChips }
