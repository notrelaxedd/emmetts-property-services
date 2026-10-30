"use client"

/** Owner edits on one parcel: what the homeowner said, the crew's home pattern, and the do-not-knock flag. */
import * as React from "react"
import { useRouter } from "next/navigation"
import { updateParcelAction } from "@/app/admin/actions/canvass"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { HOME_PATTERN_LABELS } from "@/lib/canvass/admin-rows"
import type { HomePattern } from "@/lib/db/types"

export type ParcelDetailInitial = {
  callback_window: string | null
  home_pattern: HomePattern | null
  do_not_knock: boolean
  do_not_knock_reason: string | null
}

const PATTERNS = Object.keys(HOME_PATTERN_LABELS) as HomePattern[]
const CALLBACK_CHIPS = ["Weekdays after 5", "Weekends", "Mornings"] as const

export function ParcelDetailForm({ id, initial }: { id: string; initial: ParcelDetailInitial }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [v, setV] = React.useState(initial)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await updateParcelAction(id, {
        callback_window: v.callback_window?.trim() ? v.callback_window.trim() : null,
        home_pattern: v.home_pattern,
        do_not_knock: v.do_not_knock,
        do_not_knock_reason: v.do_not_knock ? (v.do_not_knock_reason?.trim() ? v.do_not_knock_reason.trim() : null) : null,
      })
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
      if (r.ok) router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="p-callback">What the homeowner said</Label>
        <Input
          id="p-callback"
          value={v.callback_window ?? ""}
          maxLength={200}
          onChange={(e) => setV((s) => ({ ...s, callback_window: e.target.value }))}
          placeholder="Weekdays after 5, Saturday mornings…"
        />
        <div className="flex flex-wrap gap-1.5">
          {CALLBACK_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setV((s) => ({ ...s, callback_window: c }))}
              className="rounded-full border border-ink/25 bg-white px-2.5 py-0.5 text-xs font-medium text-ink hover:bg-gray-light"
            >
              {c}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Overrides every estimate. Leave blank if they did not say.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="p-pattern">Home pattern (crew observed)</Label>
        <NativeSelect
          id="p-pattern"
          value={v.home_pattern ?? ""}
          onChange={(e) => setV((s) => ({ ...s, home_pattern: (e.target.value || null) as HomePattern | null }))}
        >
          <option value="">Not set</option>
          {PATTERNS.map((p) => (
            <option key={p} value={p}>
              {HOME_PATTERN_LABELS[p]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2 rounded-md border border-ink/10 bg-gray-light/40 p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium text-ink">Do not knock</span>
            <span className="block text-xs text-ink-muted">Kept forever. The house never appears in a plan.</span>
          </span>
          <Switch checked={v.do_not_knock} onCheckedChange={(c) => setV((s) => ({ ...s, do_not_knock: c }))} aria-label="Do not knock" />
        </label>
        {v.do_not_knock ? (
          <div className="space-y-1.5">
            <Label htmlFor="p-dnk-reason">Reason</Label>
            <Input
              id="p-dnk-reason"
              value={v.do_not_knock_reason ?? ""}
              maxLength={500}
              onChange={(e) => setV((s) => ({ ...s, do_not_knock_reason: e.target.value }))}
              placeholder="No Soliciting sign, asked us not to return…"
            />
          </div>
        ) : null}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save parcel"}
      </Button>
    </form>
  )
}
