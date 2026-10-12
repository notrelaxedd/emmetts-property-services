import { Inbox } from "lucide-react"
import { DecidedList } from "@/components/admin/inbox/decided-list"
import { InboxCard } from "@/components/admin/inbox/inbox-card"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { loadEntries } from "@/components/admin/inbox/load-context"
import {
  FILTER_KINDS,
  FILTER_LABELS,
  INBOX_FILTERS,
  isInboxFilter,
  type InboxFilter,
} from "@/components/admin/inbox/types"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireOwner } from "@/lib/auth/session"
import type { Approval, ApprovalKind } from "@/lib/db/types"
import { pendingCounts } from "@/lib/ops/approvals"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Inbox" }

const DECIDED_LIMIT = 20

function chipCount(filter: InboxFilter, counts: Record<ApprovalKind, number>): number {
  if (filter === "all") return Object.values(counts).reduce((a, b) => a + b, 0)
  return FILTER_KINDS[filter].reduce((sum, k) => sum + (counts[k] ?? 0), 0)
}

export default async function InboxPage({ searchParams }: { searchParams: { filter?: string; view?: string } }) {
  await requireOwner()
  const filter: InboxFilter = isInboxFilter(searchParams.filter) ? searchParams.filter : "all"
  const db = getSupabaseAdmin()
  if (!db) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inbox" />
        <Alert variant="warning">
          <AlertDescription>Supabase isn&apos;t configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).</AlertDescription>
        </Alert>
      </div>
    )
  }

  let pending: Approval[] = []
  let decided: Approval[] = []
  let counts: Record<ApprovalKind, number> | null = null
  let loadError: string | null = null
  try {
    let q = db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: true })
    if (filter !== "all") q = q.in("kind", FILTER_KINDS[filter])
    const [pendingRes, decidedRes, c] = await Promise.all([
      q,
      db
        .from("approvals")
        .select("*")
        .neq("status", "pending")
        .order("decided_at", { ascending: false, nullsFirst: false })
        .limit(DECIDED_LIMIT),
      pendingCounts(db),
    ])
    pending = check(pendingRes, "inbox(pending)") ?? []
    decided = check(decidedRes, "inbox(decided)") ?? []
    counts = c
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }

  const entries = await loadEntries(db, pending)
  const chips = INBOX_FILTERS.map((f) => ({
    value: f,
    label: FILTER_LABELS[f],
    count: counts ? chipCount(f, counts) : undefined,
  }))
  const total = counts ? chipCount("all", counts) : pending.length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approval inbox"
        description={total ? `${total} waiting on you, oldest first.` : "Everything the fleet drafts lands here first."}
      />
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load approvals: {loadError}</AlertDescription>
        </Alert>
      ) : null}
      <Tabs defaultValue={searchParams.view === "decided" ? "decided" : "pending"}>
        <TabsList>
          <TabsTrigger value="pending">Pending{total ? ` (${total})` : ""}</TabsTrigger>
          <TabsTrigger value="decided">Decided</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-4">
          <UrlFilterChips chips={chips} value={filter} ariaLabel="Filter approvals" />
          {entries.length ? (
            <ul className="grid gap-4">
              {entries.map((entry) => (
                <li key={entry.approval.id}>
                  <InboxCard entry={entry} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Inbox}
              title={filter === "all" ? "Inbox zero" : `No pending ${FILTER_LABELS[filter].toLowerCase()}`}
              description="New drafts from the fleet show up here for you to approve, edit or reject."
            />
          )}
        </TabsContent>
        <TabsContent value="decided">
          <DecidedList approvals={decided} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
