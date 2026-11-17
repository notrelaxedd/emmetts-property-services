import { AlertTriangle, Mail, Phone } from "lucide-react"
import { dateTime } from "@/components/admin/inbox/format"
import type { QuoteSubmission } from "@/lib/db/types"
import { formatPhone } from "@/lib/ops/phone"
import { getSupabaseAdmin } from "@/lib/supabase/admin"
import { DismissSubmissionButton } from "./dismiss-submission-button"

/** How long a submission that never became a lead stays on the list (unless dismissed). */
const DAYS = 60
/** A submission still 'received' after this long died part way (the request crashed). */
const STUCK_MS = 2 * 60 * 1000

const WHY: Record<string, string> = {
  rejected: "The form turned it away",
  failed: "Our server hit an error",
  received: "The request stopped part way",
}

/**
 * Quote-form submissions that didn't become a lead: the customer pressed Send but the form turned it
 * away (a field they didn't fix, the rate limit), or the server failed. Everything they typed is here
 * so they can be called back. Rows come from `quote_submissions` (saved before anything else runs).
 */
export async function UnsavedSubmissions() {
  const db = getSupabaseAdmin()
  if (!db) return null
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
  const { data, error } = await db
    .from("quote_submissions")
    .select("*")
    .neq("outcome", "saved")
    .is("dismissed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) {
    // The table arrives with migration 20261117000100; until then there is simply nothing to show.
    console.error("[admin] quote_submissions:", error.message)
    return null
  }
  const now = Date.now()
  const rows = ((data ?? []) as QuoteSubmission[]).filter(
    (r) => r.outcome !== "received" || now - new Date(r.created_at).getTime() > STUCK_MS,
  )
  if (!rows.length) return null

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4" aria-labelledby="unsaved-subs">
      <h2 id="unsaved-subs" className="flex items-center gap-2 font-semibold text-amber-950">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {rows.length === 1 ? "1 quote request didn't go through" : `${rows.length} quote requests didn't go through`}
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        These people pressed Send but no lead was made. Call them back, then take them off the list.
      </p>
      <ul className="mt-3 divide-y divide-amber-200 overflow-hidden rounded-md border border-amber-200 bg-white">
        {rows.map((r) => {
          const form = r.form as { services?: string[]; customRequest?: string; snowList?: boolean }
          const wants = [...(form.services ?? []), form.snowList ? "snow (per push)" : null].filter(Boolean).join(", ")
          return (
            <li key={r.id} className="flex items-start gap-3 px-3 py-3 text-sm">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="font-semibold text-ink">{r.name || "(no name given)"}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {r.phone ? (
                    <a className="inline-flex items-center gap-1 underline" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>
                      <Phone className="size-3.5" aria-hidden="true" />
                      {formatPhone(r.phone)}
                    </a>
                  ) : null}
                  {r.email ? (
                    <a className="inline-flex items-center gap-1 underline" href={`mailto:${r.email}`}>
                      <Mail className="size-3.5" aria-hidden="true" />
                      {r.email}
                    </a>
                  ) : null}
                </div>
                {r.address ? <div className="text-ink-body">{r.address}</div> : null}
                {wants ? <div className="text-ink-body">Wants: {wants}</div> : null}
                {form.customRequest ? <div className="text-ink-muted">&ldquo;{form.customRequest}&rdquo;</div> : null}
                <div className="text-xs text-ink-muted">
                  {dateTime(r.created_at)} · {WHY[r.outcome] ?? r.outcome}
                  {r.reason ? `: ${r.reason}` : ""}
                </div>
              </div>
              <DismissSubmissionButton id={r.id} label={r.name || "this request"} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
