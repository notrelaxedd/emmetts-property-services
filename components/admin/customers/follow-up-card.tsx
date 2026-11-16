"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, Check, Copy, Mail, MessageSquare, ThumbsDown } from "lucide-react"
import { markFollowUpPassed, markFollowUpSent } from "@/app/admin/actions/followups"
import type { FollowUpRow } from "@/app/admin/customers/follow-ups/load"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { CADENCE, KIND_LABEL, type FollowUpKind } from "@/lib/followups/plan"

const CHECK_BACK = [
  { days: 2, label: "2 days" },
  { days: 4, label: "4 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
]

/** Hot leads get chased sooner than past customers. */
const DEFAULT_DAYS: Record<FollowUpKind, number> = {
  needs_quote: 2,
  quote_waiting: CADENCE.quoteAgain,
  price_given: CADENCE.quoteAgain,
  check_back: 7,
  past_customer: CADENCE.keepWarm,
  never_booked: CADENCE.keepWarm,
}

const HOT: FollowUpKind[] = ["needs_quote", "quote_waiting", "price_given"]

function dueLabel(overdue: number): string {
  if (overdue === 0) return "Due today"
  if (overdue > 0) return `${overdue} day${overdue === 1 ? "" : "s"} overdue`
  return `Due in ${-overdue} day${overdue === -1 ? "" : "s"}`
}

export function FollowUpCard({ row }: { row: FollowUpRow }) {
  const { pending, run } = useActionRunner()
  const { toast } = useToast()
  const [message, setMessage] = React.useState(row.message)
  const [days, setDays] = React.useState(DEFAULT_DAYS[row.kind])
  const ids = { msg: React.useId(), days: React.useId() }
  const about = row.sell[0]?.name ?? (row.kind === "quote_waiting" || row.kind === "needs_quote" ? "Quote" : "Follow-up")
  const body = encodeURIComponent(message)

  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/customers/${row.customerId}`} className="block truncate text-base font-bold text-ink hover:underline">
            {row.name}
          </Link>
          <p className="text-sm text-ink-body">{row.reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={HOT.includes(row.kind) ? "warning" : "outline"}>{KIND_LABEL[row.kind]}</Badge>
          <span className={row.overdue > 0 ? "text-xs font-semibold text-red-700" : "text-xs text-ink-muted"}>{dueLabel(row.overdue)}</span>
        </div>
      </header>

      {row.sell.length ? (
        <div className="rounded-md bg-brand-green/10 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">What to sell</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {row.sell.map((s) => (
              <li key={s.slug}>
                <span className="font-semibold">{s.name}:</span> {s.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.link ? (
        <Button asChild size="sm" variant="outline" className="self-start">
          <Link href={row.link.href}>
            {row.link.label} <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      ) : null}

      <div className="grid gap-1.5">
        <label htmlFor={ids.msg} className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Message
        </label>
        <Textarea id={ids.msg} value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="text-sm" />
      </div>

      <div className="flex flex-wrap gap-2">
        {row.phone ? (
          <Button asChild size="sm">
            <a href={`sms:${row.phone.replace(/[^\d+]/g, "")}?&body=${body}`}>
              <MessageSquare aria-hidden="true" /> Text
            </a>
          </Button>
        ) : null}
        {row.email ? (
          <Button asChild size="sm" variant={row.phone ? "outline" : "default"}>
            <a href={`mailto:${row.email}?subject=${encodeURIComponent("Emmett's Property Services")}&body=${body}`}>
              <Mail aria-hidden="true" /> Email
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(message).then(
              () => toast({ title: "Message copied", variant: "success" }),
              () => toast({ title: "Couldn't copy. Select the text and copy it by hand.", variant: "destructive" }),
            )
          }
        >
          <Copy aria-hidden="true" /> Copy
        </Button>
        {!row.phone && !row.email ? <p className="self-center text-xs font-medium text-amber-700">No phone or email on file. Stop by, or add one on their page.</p> : null}
      </div>

      <div className="mt-auto flex flex-wrap items-end gap-2 border-t border-ink/10 pt-3">
        <div className="grid gap-1">
          <label htmlFor={ids.days} className="text-xs text-ink-muted">
            Check back in
          </label>
          <NativeSelect id={ids.days} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {CHECK_BACK.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => markFollowUpSent({ customerId: row.customerId, about, days }))}>
          <Check aria-hidden="true" /> I sent it
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Mark ${row.name} as not interested for now? They come back on the list in about 3 months.`))
              void run(() => markFollowUpPassed({ customerId: row.customerId, about }))
          }}
        >
          <ThumbsDown aria-hidden="true" /> Not interested
        </Button>
      </div>
    </article>
  )
}
