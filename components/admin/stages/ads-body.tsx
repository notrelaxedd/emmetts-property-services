import { Megaphone } from "lucide-react"
import { AdItem } from "@/components/admin/ads/ad-item"
import { DraftAdForm } from "@/components/admin/ads/draft-ad-form"
import { UrlFilterChips } from "@/components/admin/inbox/inbox-filters"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import type { Ad, AdStatus } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

const STATUSES: AdStatus[] = ["draft", "approved", "posted"]
const LABELS: Record<AdStatus | "all", string> = { all: "All", draft: "Drafts", approved: "Ready to post", posted: "Posted" }

export function parseAdStatus(v: string | undefined): AdStatus | "all" {
  return (STATUSES as string[]).includes(v ?? "") ? (v as AdStatus) : "all"
}

/**
 * The Ads page body (`/admin/ads`), also the front page's Ads stage. `variant="panel"` uses the
 * `adStatus` param on `/admin?stage=ads`, shows each ad as the post will look, and adds Approve on
 * drafts (the same decision as the inbox ad card).
 */
export async function AdsBody({ status, variant = "page" }: { status: AdStatus | "all"; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  const db = getSupabaseAdmin()

  let ads: Ad[] = []
  let approvalByAd = new Map<string, string>()
  let error: string | null = null
  if (db) {
    try {
      ads = check(await db.from("ads").select("*").order("created_at", { ascending: false }).limit(200), "ads") ?? []
      const draftIds = ads.filter((a) => a.status === "draft").map((a) => a.id)
      if (panel && draftIds.length) {
        const rows =
          check(
            await db.from("approvals").select("id,ref_id").eq("kind", "ad").eq("status", "pending").in("ref_id", draftIds),
            "ad approvals",
          ) ?? []
        approvalByAd = new Map(rows.map((r) => [r.ref_id, r.id]))
      }
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
      {panel ? null : (
        <PageHeader
          title="Ads"
          description="Approved ads are ready to paste into Ads Manager or Nextdoor. v1 doesn't post automatically."
        />
      )}
      <DraftAdForm submitLabel={panel ? "Write an ad" : undefined} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <UrlFilterChips
        param={panel ? "adStatus" : "status"}
        basePath={panel ? "/admin?stage=ads" : undefined}
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
              {panel ? <AdItem ad={ad} preview approvalId={approvalByAd.get(ad.id) ?? null} /> : <AdItem ad={ad} />}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Megaphone} title="No ads here yet" description="Draft one above, or wait for the weekly ad run." />
      )}
    </div>
  )
}
