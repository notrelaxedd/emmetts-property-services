"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { COME_BACK_OPTIONS, callbackWindowText } from "@/lib/canvass/walk-links"

export type ComebackPickerProps = {
  /** The words to save as the knock's callback_window. */
  onConfirm: (window: string) => void
  onCancel: () => void
}

/** "Come back later": Weekday evenings / Weekends / your own words. Saving logs the knock as call_back. */
export function ComebackPicker({ onConfirm, onCancel }: ComebackPickerProps) {
  const [custom, setCustom] = React.useState("")
  const [typing, setTyping] = React.useState(false)
  const text = callbackWindowText("custom", custom)

  return (
    <div role="group" aria-label="When should we come back?" className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">When should we come back?</p>
      <div className="grid grid-cols-2 gap-2">
        {COME_BACK_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onConfirm(callbackWindowText(opt) as string)}
            className="min-h-14 rounded-lg border border-ink/15 bg-white px-3 py-2 text-[0.9375rem] font-semibold text-ink hover:bg-ink/[0.04] active:scale-[0.98]"
          >
            {opt}
          </button>
        ))}
      </div>
      {typing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text) onConfirm(text)
          }}
        >
          <label htmlFor="comeback-custom" className="sr-only">
            Come back when
          </label>
          <Input
            id="comeback-custom"
            autoFocus
            value={custom}
            maxLength={200}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. after 5 on Thursdays"
            className="h-12 text-base"
          />
          <button
            type="submit"
            disabled={!text}
            className="h-12 shrink-0 rounded-lg bg-ink px-4 text-[0.9375rem] font-semibold text-white disabled:opacity-40"
          >
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="min-h-14 rounded-lg border border-ink/15 bg-white px-3 py-2 text-[0.9375rem] font-semibold text-ink hover:bg-ink/[0.04]"
        >
          Custom
        </button>
      )}
      <button type="button" onClick={onCancel} className="h-11 rounded-lg text-sm font-semibold text-ink-muted hover:bg-ink/[0.04]">
        Back
      </button>
    </div>
  )
}
