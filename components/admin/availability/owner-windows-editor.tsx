"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
import { saveOwnerWindows } from "@/app/admin/actions/availability"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { WEEK_ORDER, WEEKDAY_NAME } from "./shared"

export type WindowBlock = { weekday: number; start_time: string; end_time: string }
type Draft = WindowBlock & { key: string }

let seq = 0
const key = () => `b${++seq}`

export function OwnerWindowsEditor({ initial }: { initial: WindowBlock[] }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [blocks, setBlocks] = React.useState<Draft[]>(() => initial.map((b) => ({ ...b, key: key() })))
  const [dirty, setDirty] = React.useState(false)

  const update = (k: string, patch: Partial<WindowBlock>) => {
    setBlocks((bs) => bs.map((b) => (b.key === k ? { ...b, ...patch } : b)))
    setDirty(true)
  }
  const add = (weekday: number) => {
    const day = blocks.filter((b) => b.weekday === weekday).sort((a, b) => a.end_time.localeCompare(b.end_time))
    const last = day[day.length - 1]
    const start = last ? last.end_time : "08:00"
    const startH = Number(start.slice(0, 2))
    const end = startH >= 22 ? "23:30" : `${String(Math.min(23, startH + 4)).padStart(2, "0")}:${start.slice(3, 5)}`
    setBlocks((bs) => [...bs, { weekday, start_time: start, end_time: end, key: key() }])
    setDirty(true)
  }
  const remove = (k: string) => {
    setBlocks((bs) => bs.filter((b) => b.key !== k))
    setDirty(true)
  }
  const save = () =>
    startTransition(async () => {
      const r = await saveOwnerWindows(blocks.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })))
      if (r.ok) {
        setDirty(false)
        toast({ title: r.message ?? "Saved", variant: "success" })
      } else toast({ title: "Couldn't save your hours", description: r.reason, variant: "destructive" })
    })

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
        {WEEK_ORDER.map((wd) => {
          const day = blocks.filter((b) => b.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time))
          return (
            <li key={wd} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <span className="w-28 shrink-0 pt-1.5 text-sm font-semibold text-ink">{WEEKDAY_NAME[wd]}</span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {day.length === 0 ? <span className="pt-1.5 text-sm text-ink-muted">Closed</span> : null}
                {day.map((b) => (
                  <span key={b.key} className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-white p-1">
                    <Input
                      type="time"
                      step={1800}
                      aria-label={`${WEEKDAY_NAME[wd]} start`}
                      value={b.start_time}
                      onChange={(e) => update(b.key, { start_time: e.target.value })}
                      className="h-8 w-[6.5rem]"
                    />
                    <span className="text-ink-muted">–</span>
                    <Input
                      type="time"
                      step={1800}
                      aria-label={`${WEEKDAY_NAME[wd]} end`}
                      value={b.end_time}
                      onChange={(e) => update(b.key, { end_time: e.target.value })}
                      className="h-8 w-[6.5rem]"
                    />
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => remove(b.key)}>
                      <Trash2 />
                      <span className="sr-only">Remove block</span>
                    </Button>
                  </span>
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={() => add(wd)}>
                  <Plus /> Add hours
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save open hours"}
        </Button>
        {dirty ? <span className="text-sm text-ink-muted">Unsaved changes</span> : null}
      </div>
    </div>
  )
}
