"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus } from "lucide-react"
import { saveOfferTextAction, savePitchAction, type PitchInput } from "@/app/admin/actions/hangers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import type { Pitch } from "@/lib/db/types"

type Draft = { id?: string; name: string; script: string; active: boolean }

const EMPTY: Draft = { name: "", script: "", active: true }

/** The scripts the crew picks at session start: list, inline add / edit form, active toggle. */
export function PitchesEditor({ pitches }: { pitches: Pitch[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [draft, setDraft] = React.useState<Draft | null>(null)

  const save = (input: PitchInput, done?: () => void) => {
    startTransition(async () => {
      const r = await savePitchAction(input)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
      if (r.ok) {
        done?.()
        router.refresh()
      }
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    if (!draft.name.trim()) {
      toast({ title: "Give the pitch a name", variant: "destructive" })
      return
    }
    save(draft, () => setDraft(null))
  }

  const form = (
    <form onSubmit={submit} className="space-y-3 border-t border-ink/10 bg-paper/60 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="pitch-name">Name</Label>
          <Input
            id="pitch-name"
            value={draft?.name ?? ""}
            maxLength={80}
            placeholder="Neighbor special"
            onChange={(e) => setDraft((d) => ({ ...(d ?? EMPTY), name: e.target.value }))}
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Switch checked={draft?.active ?? true} onCheckedChange={(c) => setDraft((d) => ({ ...(d ?? EMPTY), active: c }))} />
          Active
        </label>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pitch-script">Script</Label>
        <Textarea
          id="pitch-script"
          value={draft?.script ?? ""}
          maxLength={2000}
          rows={3}
          placeholder="What the crew says at the door"
          onChange={(e) => setDraft((d) => ({ ...(d ?? EMPTY), script: e.target.value }))}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {draft?.id ? "Save pitch" : "Add pitch"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </form>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Pitches</h2>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setDraft({ ...EMPTY })}>
          <Plus /> Add pitch
        </Button>
      </div>
      {pitches.length === 0 && !draft ? (
        <p className="px-4 py-6 text-center text-sm text-ink-muted">No pitches yet. Add one so the crew can pick it at the door.</p>
      ) : null}
      <ul className="divide-y divide-ink/10">
        {pitches.map((p) =>
          draft?.id === p.id ? (
            <li key={p.id}>{form}</li>
          ) : (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {p.name}
                  {p.active ? null : <Badge variant="outline">Inactive</Badge>}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-ink-muted">{p.script || "No script yet."}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Switch
                  checked={p.active}
                  disabled={pending}
                  aria-label={`${p.name} active`}
                  onCheckedChange={(c) => save({ id: p.id, name: p.name, script: p.script, active: c })}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`Edit ${p.name}`}
                onClick={() => setDraft({ id: p.id, name: p.name, script: p.script, active: p.active })}
              >
                <Pencil />
              </Button>
            </li>
          ),
        )}
      </ul>
      {draft && !draft.id ? form : null}
    </Card>
  )
}

/** The season offer printed on door hangers. Blank = the season default shown as the placeholder. */
export function OfferTextEditor({ initial, defaultOffer }: { initial: string | null; defaultOffer: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [text, setText] = React.useState(initial ?? "")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await saveOfferTextAction(text.trim() ? text.trim() : null)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
      if (r.ok) router.refresh()
    })
  }

  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-ink/10 px-4 py-3 text-sm font-semibold text-ink">Hanger offer</h2>
      <form onSubmit={submit} className="space-y-3 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="offer-text">Offer printed on hangers</Label>
          <Textarea id="offer-text" value={text} maxLength={240} rows={2} placeholder={defaultOffer} onChange={(e) => setText(e.target.value)} />
          <p className="text-xs text-ink-muted">Leave blank to print this season&apos;s default: &ldquo;{defaultOffer}&rdquo;</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Save offer
          </Button>
          {text ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setText("")}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  )
}
