import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { loadScheduleJobs } from "@/app/admin/schedule/load"
import { money } from "@/components/admin/inbox/format"
import type { ScheduleJob } from "@/components/admin/schedule/types"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { Job, JobStatus } from "@/lib/db/types"
import { PAYMENT_METHOD_LABEL } from "@/lib/ops/payment-methods"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { ScheduleNextStep } from "./schedule-next-step"
import { stageHref } from "./stages"

const LIMIT = 100

/** Plain words for where a job is. */
const WORDS: Partial<Record<JobStatus, { label: string; variant: "warning" | "success" | "outline" | "secondary" }>> = {
  unscheduled: { label: "Needs a day", variant: "warning" },
  proposed: { label: "Call to confirm", variant: "warning" },
  crew_confirmed: { label: "Crew free · call", variant: "warning" },
  booked: { label: "Booked", variant: "success" },
  in_progress: { label: "In progress", variant: "secondary" },
}

/** Needs a day first, then by day. */
function order(a: ScheduleJob, b: ScheduleJob): number {
  if (!a.date !== !b.date) return a.date ? 1 : -1
  return (a.date ?? "").localeCompare(b.date ?? "") || (a.startMin ?? 0) - (b.startMin ?? 0)
}

/**
 * The front page's Schedule stage: every job that isn't done or cancelled, with one next-step button
 * each (the same booking actions as the schedule board). The drag-and-drop board stays on its page.
 */
export async function SchedulePanel() {
  let jobs: ScheduleJob[] = []
  let error: string | null = null
  try {
    const db = requireSupabaseAdmin()
    const rows: Job[] =
      check(
        await db.from("jobs").select("*").not("status", "in", "(done,cancelled)").order("start_at", { ascending: true, nullsFirst: true }).limit(LIMIT),
        "schedule jobs",
      ) ?? []
    const toScheduleJob = await loadScheduleJobs(db, rows)
    jobs = rows.map(toScheduleJob).sort(order)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Drag jobs around the week on the full schedule.</p>
        <Button asChild variant="outline" className="h-11 sm:h-9">
          <Link href="/admin/schedule">
            <CalendarDays aria-hidden="true" /> Open the calendar
          </Link>
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load the schedule: {error}</AlertDescription>
        </Alert>
      ) : null}
      {jobs.length ? (
        <ul className="divide-y divide-ink/10 overflow-hidden rounded-lg border border-ink/10 bg-white">
          {jobs.map((j) => {
            const words = WORDS[j.status]
            const pays = j.quote?.paymentMethod ? `pays by ${PAYMENT_METHOD_LABEL[j.quote.paymentMethod].toLowerCase()} after the job` : null
            const quoteHref = j.quote ? stageHref("quotes", { id: j.quote.id }) : null
            return (
              <li key={j.id} className="grid gap-3 px-3 py-3 sm:px-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{j.whenLabel ?? "No day yet"}</p>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{j.customerName}</span>
                    {words ? <Badge variant={words.variant}>{words.label}</Badge> : null}
                    {j.weatherHold ? <Badge variant="outline">⛈ Hold</Badge> : null}
                  </p>
                  <p className="text-sm text-ink-body">
                    {[j.services.join(", ") || null, j.quote ? money(j.quote.priceTotal) : null].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {[
                      j.crew.filter((c) => c.status === "accepted").map((c) => c.name).join(", ") || (j.status === "unscheduled" ? null : "No crew yet"),
                      pays,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {quoteHref ? (
                      <>
                        {" · "}
                        <Link className="underline" href={quoteHref} scroll={false}>
                          Quote
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="md:max-w-md md:justify-self-end">
                  <ScheduleNextStep job={j} quoteHref={quoteHref} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : error ? null : (
        <EmptyState icon={CalendarDays} title="Nothing on the schedule" description="Quotes land here once they have a price." />
      )}
    </div>
  )
}
