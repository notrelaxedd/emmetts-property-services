import { Wallet } from "lucide-react"
import { dateLabel, hoursLabel, money } from "@/components/crew/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireCrew } from "@/lib/auth/session"
import type { CrewJob, Payout } from "@/lib/db/types"
import { addDays, formatDayLabel, weekKeyOf } from "@/lib/scheduler"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Pay" }

const HISTORY_DAYS = 182
const CHUNK = 100

type Row = Payout & { job?: Pick<CrewJob, "customer_name" | "start_at" | "completed_at"> }

export default async function CrewPayPage() {
  const { profile } = await requireCrew()
  const supabase = createSupabaseServerClient()
  if (!supabase) return <EmptyState title="Not connected" description="Supabase isn't configured yet." />

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("payouts")
    .select("*")
    .eq("crew_id", profile.id)
    .or(`paid_cash_at.is.null,created_at.gte.${since}`)
    .order("created_at", { ascending: false })
  const payouts = (data ?? []) as Payout[]

  // Job labels through the crew-safe view (customer name + date only).
  const jobIds = Array.from(new Set(payouts.map((p) => p.job_id)))
  const jobs = new Map<string, Pick<CrewJob, "id" | "customer_name" | "start_at" | "completed_at">>()
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data: rows } = await supabase
      .from("crew_jobs")
      .select("id, customer_name, start_at, completed_at")
      .in("id", jobIds.slice(i, i + CHUNK))
    for (const j of rows ?? []) jobs.set(j.id, j)
  }

  const rows: Row[] = payouts.map((p) => ({ ...p, job: jobs.get(p.job_id) }))
  const workedAt = (r: Row) => new Date(r.job?.completed_at ?? r.job?.start_at ?? r.created_at)

  const weeks = new Map<string, Row[]>()
  for (const r of rows) {
    const key = weekKeyOf(workedAt(r))
    weeks.set(key, [...(weeks.get(key) ?? []), r])
  }
  const weekKeys = Array.from(weeks.keys()).sort((a, b) => b.localeCompare(a))

  const owed = rows.filter((r) => !r.paid_cash_at).reduce((s, r) => s + Number(r.amount), 0)
  const paid = rows.filter((r) => r.paid_cash_at).reduce((s, r) => s + Number(r.amount), 0)
  const thisWeek = weekKeyOf(new Date())

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pay" description={`Cash owed per job at ${money(profile.hourly_rate)}/h.`} />

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-brand-green-dark/40 bg-brand-green/15">
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-ink-muted">Owed to you</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{money(owed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-ink-muted">Paid (last 6 mo)</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{money(paid)}</p>
          </CardContent>
        </Card>
      </div>

      {error ? <p className="text-sm text-destructive">Couldn&rsquo;t load your pay. Try again in a minute.</p> : null}

      {rows.length === 0 && !error ? (
        <EmptyState icon={Wallet} title="No pay yet" description="When you complete a job, your hours and pay show up here." />
      ) : null}

      {weekKeys.map((wk) => {
        const list = (weeks.get(wk) ?? []).sort((a, b) => workedAt(b).getTime() - workedAt(a).getTime())
        const hours = list.reduce((s, r) => s + Number(r.hours), 0)
        const amount = list.reduce((s, r) => s + Number(r.amount), 0)
        return (
          <section key={wk} aria-labelledby={`wk-${wk}`} className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-2">
              <h2 id={`wk-${wk}`} className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                {wk === thisWeek ? "This week" : `Week of ${dateLabel(wk)}`}
                <span className="sr-only"> (through {dateLabel(addDays(wk, 6))})</span>
              </h2>
              <p className="text-sm font-semibold tabular-nums text-ink">
                {hoursLabel(hours)} · {money(amount)}
              </p>
            </div>
            <Card>
              <ul className="divide-y divide-ink/10">
                {list.map((r) => (
                  <li key={r.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{r.job?.customer_name ?? "Job"}</p>
                      <p className="text-sm text-ink-muted">
                        {formatDayLabel(workedAt(r))} · {hoursLabel(Number(r.hours))} × {money(Number(r.rate))}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums text-ink">{money(Number(r.amount))}</span>
                      {r.paid_cash_at ? (
                        <Badge variant="secondary">Paid {formatDayLabel(new Date(r.paid_cash_at)).replace(/^\w+ /, "")}</Badge>
                      ) : (
                        <Badge variant="warning">Unpaid</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )
      })}
      {rows.length ? <p className="text-center text-xs text-ink-muted">Showing anything unpaid plus the last 6 months.</p> : null}
    </div>
  )
}
