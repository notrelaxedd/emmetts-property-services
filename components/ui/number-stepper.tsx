"use client"

import * as React from "react"
import { Minus, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

export interface NumberStepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Shown before the input, e.g. "$". */
  prefix?: string
  /** Shown after the input, e.g. "hrs". */
  suffix?: string
  /** Visible label above the stepper (also names the input for screen readers). */
  label?: string
  /** If set, a hidden-free named input is rendered so the value posts with a plain form. */
  name?: string
  disabled?: boolean
  className?: string
  id?: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Round to the step's precision so 0.1 + 0.2 never shows as 0.30000000000000004. */
function tidy(n: number, step: number) {
  const decimals = (String(step).split(".")[1] ?? "").length
  return Number(n.toFixed(Math.max(decimals, 2)))
}

/** A -/+ stepper with an editable input and 44px touch targets. Controlled. */
function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  prefix,
  suffix,
  label,
  name,
  disabled,
  className,
  id,
}: NumberStepperProps) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  const [draft, setDraft] = React.useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number(raw)
    setDraft(null)
    if (raw.trim() === "" || Number.isNaN(parsed)) return
    onChange(clamp(tidy(parsed, step), min, max))
  }
  const bump = (dir: 1 | -1) => onChange(clamp(tidy(value + dir * step, step), min, max))

  const btn =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-input bg-white text-ink shadow-sm transition-colors hover:bg-accent active:bg-gray-mid disabled:pointer-events-none disabled:opacity-40"

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium leading-none text-ink">
          {label}
        </label>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => bump(-1)}
          disabled={disabled || value <= min}
          aria-label={label ? `Decrease ${label}` : "Decrease"}
        >
          <Minus className="size-5" aria-hidden="true" />
        </button>
        <div className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white px-2 shadow-sm focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-brand-green-dark">
          {prefix ? <span className="text-sm text-ink-muted">{prefix}</span> : null}
          <input
            id={inputId}
            name={name}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={draft ?? String(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit(e.currentTarget.value)
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                bump(1)
              } else if (e.key === "ArrowDown") {
                e.preventDefault()
                bump(-1)
              }
            }}
            className="w-full min-w-0 bg-transparent text-center text-base font-semibold tabular-nums text-ink outline-none"
          />
          {suffix ? <span className="text-sm text-ink-muted">{suffix}</span> : null}
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => bump(1)}
          disabled={disabled || value >= max}
          aria-label={label ? `Increase ${label}` : "Increase"}
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export { NumberStepper }
