import { PartyPopper } from "lucide-react"
import { CustomersTabs } from "@/components/admin/customers/customers-tabs"
import { FollowUpCard } from "@/components/admin/customers/follow-up-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { KIND_LABEL, type FollowUpKind } from "@/lib/followups/plan"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { loadFollowUps, type FollowUpRow } from "./load"

export const dynamic = "force-dynamic"
export const metadata = { title: "Follow-ups" }

/** How far ahead "Coming up" looks. */
const AHEAD_DAYS = 14

export default async function FollowUpsPage() {
  await requireOwner()
  const today = localDate(new Date())
  let rows: FollowUpRow[] = []
  let error: string | null = null
  try {
    rows = await loadFollowUps(requireSupabaseAdmin(), today)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const due = rows.filter((r) => r.overdue >= 0)
  const soon = rows.filter((r) => r.overdue < 0 && r.overdue >= -AHEAD_DAYS).sort((a, b) => b.overdue - a.overdue)
  const counts = new Map<FollowUpKind, number>()
  for (const r of due) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)

  return (
    <div className="space-y-4">
      <PageHeader title="Follow-ups" description="Who to message today, why, and what to offer them. Nobody on file falls off this list." />
      <CustomersTabs active="follow" />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load follow-ups: {error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3" aria-labelledby="due-heading">
        <div>
          <h2 id="due-heading" className="text-lg font-bold text-ink">
            Message today ({due.length})
          </h2>
          {due.length ? (
            <p className="text-sm text-ink-muted">
              {Array.from(counts.entries())
                .map(([k, n]) => `${n} ${KIND_LABEL[k].toLowerCase()}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        {due.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {due.map((r) => (
              <li key={r.customerId}>
                <FollowUpCard row={r} />
              </li>
            ))}
          </ul>
        ) : !error ? (
          <EmptyState icon={PartyPopper} title="Nobody to message today" description="Everyone on file is booked or was messaged recently." />
        ) : null}
      </section>

      {soon.length ? (
        <section className="space-y-3" aria-labelledby="soon-heading">
          <h2 id="soon-heading" className="text-lg font-bold text-ink">
            Coming up in the next {AHEAD_DAYS} days ({soon.length})
          </h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {soon.map((r) => (
              <li key={r.customerId}>
                <FollowUpCard row={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
