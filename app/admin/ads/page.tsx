import { Megaphone } from "lucide-react"
import { AdItem } from "@/components/admin/ads/ad-item"
import { DraftAdForm } from "@/components/admin/ads/draft-ad-form"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import type { Ad, AdStatus } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Ads" }

const STATUSES: AdStatus[] = ["draft", "approved", "posted"]
const LABELS: Record<AdStatus | "all", string> = { all: "All", draft: "Drafts", approved: "Ready to post", posted: "Posted" }

export default async function AdsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  const status = (STATUSES as string[]).includes(searchParams.status ?? "") ? (searchParams.status as AdStatus) : "all"
  const db = getSupabaseAdmin()

  let ads: Ad[] = []
  let error: string | null = null
  if (db) {
    try {
      ads = check(await db.from("ads").select("*").order("created_at", { ascending: false }).limit(200), "ads") ?? []
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  } else {
    error = "Supabase isn't configured."
  }

  const counts = Object.fromEntries(STATUSES.map((s) => [s, ads.filter((a) => a.status === s).length])) as Record<AdStatus, number>
  // Ready-to-post first, then drafts waiting on approval, then history.
  const order: Record<AdStatus, number> = { approved: 0, draft: 1, posted: 2 }
  const shown = (status === "all" ? ads : ads.filter((a) => a.status === status)).sort(
    (a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at),
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ads"
        description="Approved ads are ready to paste into Ads Manager or Nextdoor. v1 doesn't post automatically."
      />
      <DraftAdForm />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <UrlFilterChips
        param="status"
        ariaLabel="Filter ads by status"
        value={status}
        chips={[
          { value: "all", label: LABELS.all, count: ads.length },
          ...STATUSES.map((s) => ({ value: s, label: LABELS[s], count: counts[s] })),
        ]}
      />
      {shown.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((ad) => (
            <li key={ad.id}>
              <AdItem ad={ad} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Megaphone} title="No ads here yet" description="Draft one above, or wait for the weekly ad run." />
      )}
    </div>
  )
}
