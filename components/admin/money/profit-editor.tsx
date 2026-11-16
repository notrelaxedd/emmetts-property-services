"use client"

import * as React from "react"
import { Check, Pencil, RotateCcw, X } from "lucide-react"
import { setJobProfit } from "@/app/admin/actions/money"
import { usd } from "@/app/admin/money/math"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

/** The Profit cell of a finished job on the Money page: tap the pencil to type your own number. */
export function ProfitEditor({ jobId, profit, edited, customerName }: { jobId: string; profit: number; edited: boolean; customerName: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(String(profit))

  const save = (next: number | null) =>
    startTransition(async () => {
      const r = await setJobProfit(jobId, next)
      if (r.ok) {
        toast({ title: r.message ?? "Saved", variant: "success" })
        setEditing(false)
      } else toast({ title: "Couldn't save the profit", description: r.reason, variant: "destructive" })
    })

  if (editing) {
    return (
      <form
        className="flex items-center justify-end gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          const n = Number(value.replace(/[$,\s]/g, ""))
          if (!value.trim() || !Number.isFinite(n)) return toast({ title: "Enter a dollar amount", variant: "destructive" })
          save(n)
        }}
      >
        <span className="text-ink-muted">$</span>
        <Input
          autoFocus
          inputMode="decimal"
          aria-label={`Profit for ${customerName}`}
          className="h-8 w-24 text-right tabular-nums"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
        />
        <Button type="submit" variant="ghost" size="icon" className="size-8" disabled={pending}>
          <Check />
          <span className="sr-only">Save</span>
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={pending} onClick={() => setEditing(false)}>
          <X />
          <span className="sr-only">Cancel</span>
        </Button>
      </form>
    )
  }

  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className={cn("tabular-nums", profit < 0 && "text-destructive")}>{usd(profit)}</span>
      {edited ? <span className="text-xs font-normal text-ink-muted">edited</span> : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={pending}
        onClick={() => {
          setValue(String(profit))
          setEditing(true)
        }}
      >
        <Pencil className="size-3.5" />
        <span className="sr-only">Edit profit for {customerName}</span>
      </Button>
      {edited ? (
        <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => save(null)}>
          <RotateCcw className="size-3.5" />
          <span className="sr-only">Undo the edit for {customerName}</span>
        </Button>
      ) : null}
    </span>
  )
}
