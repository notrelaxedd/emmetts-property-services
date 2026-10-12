"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AdTargeting, Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { label } from "../format"
import type { AdContext } from "../types"
import { useDecide } from "../use-action"

export function targetingSummary(t: AdTargeting | null | undefined): string {
  if (!t) return "—"
  const parts: string[] = []
  if (t.radius_miles) parts.push(`${t.radius_miles} mi radius`)
  if (t.cities?.length) parts.push(t.cities.join(", "))
  if (t.age_min || t.age_max) parts.push(`ages ${t.age_min ?? "18"}–${t.age_max ?? "65+"}`)
  if (t.interests?.length) parts.push(`interests: ${t.interests.join(", ")}`)
  return parts.length ? parts.join(" · ") : "—"
}

const s = (v: unknown) => (typeof v === "string" ? v : "")

export function AdCard({ approval, context }: { approval: Approval; context: AdContext }) {
  const d = useDecide(approval.id)
  const ad = context.ad
  const original = {
    headline: s(approval.payload.headline) || ad?.headline || "",
    body: s(approval.payload.body) || ad?.body || "",
    cta: s(approval.payload.cta) || ad?.cta || "",
  }
  const channel = s(approval.payload.channel) || ad?.channel || ""
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(original)
  const ids = { h: React.useId(), b: React.useId(), c: React.useId() }

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          edit={{ kind: "toggle", onClick: () => setEditing(true) }}
          editing={editing}
          onCancelEdit={() => {
            setEditing(false)
            setDraft(original)
          }}
          onApproveEdited={() =>
            d.decide(
              "edited",
              { payloadPatch: { headline: draft.headline.trim(), body: draft.body.trim(), cta: draft.cta.trim() } },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {channel ? <Badge variant="outline">{label(channel)}</Badge> : null}
        {ad?.season ? <Badge variant="secondary">{label(ad.season)}</Badge> : null}
        {ad?.offer ? <span className="text-sm text-ink-muted">Offer: {ad.offer}</span> : null}
      </div>
      {editing ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.h}>Headline</Label>
            <Input id={ids.h} value={draft.headline} maxLength={200} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.b}>Body</Label>
            <Textarea id={ids.b} rows={5} value={draft.body} maxLength={3000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.c}>Call to action</Label>
            <Input id={ids.c} value={draft.cta} maxLength={100} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-ink/10 bg-paper p-3">
          <p className="font-semibold text-ink">{original.headline || "(no headline)"}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-body">{original.body}</p>
          {original.cta ? (
            <p className="mt-2 inline-block rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{original.cta}</p>
          ) : null}
        </div>
      )}
      <Facts
        items={[
          ["Targeting", targetingSummary(ad?.targeting)],
          ["UTM code", ad?.utm_code ?? "—"],
        ]}
      />
      <p className="text-xs text-ink-muted">After approval, post it from the Ads page (v1 doesn&apos;t auto-post).</p>
    </ApprovalShell>
  )
}
