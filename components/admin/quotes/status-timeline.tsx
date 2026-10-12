import { Check, Circle, X } from "lucide-react"
import { dateTime } from "@/components/admin/inbox/format"
import type { Quote } from "@/lib/db/types"
import { cn } from "@/lib/utils"

type Step = { label: string; at: string | null; state: "done" | "current" | "todo" | "bad" }

/** draft → needs_owner → sent → accepted / expired / declined, with timestamps where we have them. */
export function buildTimeline(quote: Quote, ownerCardAt: string | null): Step[] {
  const order = ["draft", "needs_owner", "sent", "accepted", "expired", "declined"] as const
  const rank = order.indexOf(quote.status)
  const reachedSent = quote.sent_at !== null || rank >= 2
  const steps: Step[] = [
    { label: "Draft", at: quote.created_at, state: "done" },
    {
      label: "Needs owner",
      at: ownerCardAt,
      state: quote.status === "needs_owner" ? "current" : rank > 1 || ownerCardAt ? "done" : "todo",
    },
    { label: "Sent", at: quote.sent_at, state: quote.status === "sent" ? "current" : reachedSent ? "done" : "todo" },
  ]
  if (quote.status === "expired") steps.push({ label: "Expired", at: quote.expires_at, state: "bad" })
  else if (quote.status === "declined") steps.push({ label: "Declined", at: quote.updated_at, state: "bad" })
  else
    steps.push({
      label: quote.status === "accepted" ? "Accepted (paid)" : "Accepted",
      at: quote.accepted_at,
      state: quote.status === "accepted" ? "done" : "todo",
    })
  return steps
}

export function StatusTimeline({ quote, ownerCardAt }: { quote: Quote; ownerCardAt: string | null }) {
  const steps = buildTimeline(quote, ownerCardAt)
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-2 text-sm">
          <span
            className={cn(
              "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
              s.state === "done" && "bg-brand-green text-ink",
              s.state === "current" && "bg-ink text-white",
              s.state === "todo" && "border border-ink/25 text-ink-muted",
              s.state === "bad" && "bg-destructive text-destructive-foreground",
            )}
            aria-hidden="true"
          >
            {s.state === "bad" ? <X className="size-3" /> : s.state === "todo" ? <Circle className="size-2" /> : <Check className="size-3" />}
          </span>
          <span className="min-w-0">
            <span className={cn("font-medium", s.state === "todo" ? "text-ink-muted" : "text-ink")}>{s.label}</span>
            <span className="block text-xs text-ink-muted">{s.at ? dateTime(s.at) : s.state === "todo" ? "" : "—"}</span>
          </span>
        </li>
      ))}
      {quote.status === "sent" && quote.expires_at ? (
        <li className="pl-7 text-xs text-ink-muted">Link valid until {dateTime(quote.expires_at)}</li>
      ) : null}
    </ol>
  )
}
