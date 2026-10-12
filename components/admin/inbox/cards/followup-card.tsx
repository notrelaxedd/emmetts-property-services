"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Approval } from "@/lib/db/types"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { label } from "../format"
import type { FollowupContext } from "../types"
import { useDecide } from "../use-action"

const s = (v: unknown) => (typeof v === "string" ? v : "")

export function FollowupCard({ approval, context }: { approval: Approval; context: FollowupContext }) {
  const d = useDecide(approval.id)
  const { messages, recipients } = context
  const first = messages[0]
  const original = {
    subject: s(approval.payload.subject) || first?.subject || "",
    body: s(approval.payload.body) || first?.body || "",
  }
  const kind = s(approval.payload.kind) || first?.kind || ""
  const channel = first?.channel
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(original)
  const ids = { s: React.useId(), b: React.useId() }
  const count = Math.max(recipients.length, messages.length)

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel={count > 1 ? `Approve & send to ${count}` : "Approve & send"}
          edit={{ kind: "toggle", onClick: () => setEditing(true) }}
          editing={editing}
          onCancelEdit={() => {
            setEditing(false)
            setDraft(original)
          }}
          onApproveEdited={() =>
            d.decide(
              "edited",
              { payloadPatch: { subject: draft.subject.trim(), body: draft.body.trim() } },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {kind ? <Badge variant="outline">{label(kind)}</Badge> : null}
        {channel ? <Badge variant="secondary">{channel === "sms" ? "Text" : "Email"}</Badge> : null}
      </div>
      <Facts
        items={[
          [
            "To",
            count === 0
              ? "—"
              : count === 1
                ? `${recipients[0]?.name ?? "1 customer"}${recipients[0]?.email ? ` <${recipients[0].email}>` : ""}`
                : `${count} customers (${recipients
                    .slice(0, 4)
                    .map((r) => r.name)
                    .join(", ")}${count > 4 ? ", …" : ""})`,
          ],
        ]}
      />
      {editing ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.s}>Subject</Label>
            <Input id={ids.s} value={draft.subject} maxLength={300} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.b}>Message</Label>
            <Textarea id={ids.b} rows={8} value={draft.body} maxLength={10000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-ink/10 bg-paper p-3">
          {original.subject ? <p className="font-semibold text-ink">{original.subject}</p> : null}
          <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-line text-sm text-ink-body">{original.body || "(empty)"}</p>
        </div>
      )}
      <p className="text-xs text-ink-muted">Customers who unsubscribed or didn&apos;t opt in are skipped automatically.</p>
    </ApprovalShell>
  )
}
