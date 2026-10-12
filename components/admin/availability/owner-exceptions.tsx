"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { addOwnerException, deleteOwnerException } from "@/app/admin/actions/availability"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { prettyDate, prettyRange } from "./shared"

export type OwnerExceptionRow = {
  id: string
  date: string
  closed: boolean
  start_time: string | null
  end_time: string | null
  note: string | null
}

export function OwnerExceptions({ rows, today }: { rows: OwnerExceptionRow[]; today: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [date, setDate] = React.useState("")
  const [closed, setClosed] = React.useState(true)
  const [start, setStart] = React.useState("09:00")
  const [end, setEnd] = React.useState("13:00")
  const [note, setNote] = React.useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await addOwnerException({
        date,
        closed,
        start_time: closed ? null : start,
        end_time: closed ? null : end,
        note: note.trim() || null,
      })
      if (r.ok) {
        toast({ title: r.message ?? "Saved", variant: "success" })
        setDate("")
        setNote("")
      } else toast({ title: "Couldn't add that day", description: r.reason, variant: "destructive" })
    })
  }

  const remove = (id: string) =>
    startTransition(async () => {
      const r = await deleteOwnerException(id)
      toast(r.ok ? { title: r.message ?? "Removed", variant: "success" } : { title: "Couldn't remove it", description: r.reason, variant: "destructive" })
    })

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid gap-3 rounded-md border border-ink/10 p-3 sm:grid-cols-2 lg:grid-cols-[10rem_auto_1fr_1fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="ex-date">Date</Label>
          <Input id="ex-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm font-medium text-ink">
          <Checkbox checked={closed} onCheckedChange={(v) => setClosed(v === true)} />
          Closed all day
        </label>
        {closed ? (
          <div className="hidden lg:block" />
        ) : (
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ex-start">From</Label>
              <Input id="ex-start" type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-end">To</Label>
              <Input id="ex-end" type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ex-note">Note</Label>
          <Input id="ex-note" placeholder="e.g. Family trip" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending || !date}>
          Add day
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No days off or custom hours coming up.</p>
      ) : (
        <ul className="divide-y divide-ink/10 rounded-md border border-ink/10">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-28 shrink-0 font-semibold text-ink">{prettyDate(r.date)}</span>
              {r.closed ? (
                <Badge variant="destructive">Closed</Badge>
              ) : (
                <Badge variant="outline">{r.start_time && r.end_time ? prettyRange(r.start_time, r.end_time) : "Custom"}</Badge>
              )}
              <span className="min-w-0 flex-1 truncate text-ink-muted">{r.note}</span>
              <Button variant="ghost" size="icon" className="size-8" disabled={pending} onClick={() => remove(r.id)}>
                <Trash2 />
                <span className="sr-only">Delete {r.date}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
