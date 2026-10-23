import Link from "next/link"
import { Users } from "lucide-react"
import { EmployeesTable, type EmployeeRow } from "@/components/admin/employees/employees-table"
import { EmployeesTabs } from "@/components/admin/employees/employees-tabs"
import { InviteForm } from "@/components/admin/employees/invite-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { SETTINGS_ID } from "@/lib/db/types"
import { addDays, localDate, weekStart, zonedToUtc } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Employees" }

async function load() {
  const db = requireSupabaseAdmin()
  const monday = weekStart(localDate(new Date()))
  const from = zonedToUtc(monday, "00:00").toISOString()
  const to = zonedToUtc(addDays(monday, 7), "00:00").toISOString()

  const [profiles, weekJobs, unpaid, settings] = await Promise.all([
    db.from("profiles").select("*").in("role", ["owner", "crew"]).order("role", { ascending: false }).order("name"),
    db.from("jobs").select("id,est_minutes").gte("start_at", from).lt("start_at", to).neq("status", "cancelled"),
    db.from("payouts").select("crew_id,amount").is("paid_cash_at", null),
    db.from("settings").select("default_wage").eq("id", SETTINGS_ID).maybeSingle(),
  ])
  for (const r of [profiles, weekJobs, unpaid]) if (r.error) throw new Error(r.error.message)

  const minutesByJob = new Map((weekJobs.data ?? []).map((j) => [j.id, j.est_minutes]))
  const accepted = minutesByJob.size
    ? await db.from("job_assignments").select("crew_id,job_id").eq("status", "accepted").in("job_id", Array.from(minutesByJob.keys()))
    : { data: [] as { crew_id: string; job_id: string }[], error: null }
  if (accepted.error) throw new Error(accepted.error.message)

  const minutes = new Map<string, number>()
  for (const a of accepted.data ?? []) minutes.set(a.crew_id, (minutes.get(a.crew_id) ?? 0) + (minutesByJob.get(a.job_id) ?? 0))
  const owed = new Map<string, number>()
  for (const p of unpaid.data ?? []) owed.set(p.crew_id, (owed.get(p.crew_id) ?? 0) + Number(p.amount))

  const all: EmployeeRow[] = (profiles.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    phone: p.phone,
    email: p.email,
    hourlyRate: Number(p.hourly_rate),
    maxHoursWeek: Number(p.max_hours_week),
    paused: p.paused,
    hoursThisWeek: (minutes.get(p.id) ?? 0) / 60,
    cashOwed: Math.round((owed.get(p.id) ?? 0) * 100) / 100,
    removed: p.removed_at !== null,
  }))
  const rows = all.filter((r) => !r.removed)
  const removed = all.filter((r) => r.removed)
  return { rows, removed, defaultWage: Number(settings.data?.default_wage ?? 15) }
}

export default async function EmployeesPage({ searchParams }: { searchParams: { removed?: string } }) {
  const showRemoved = searchParams.removed === "1"
  await requireOwner()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Employees" description="Crew, pay rates, hours this week and cash owed." />
      <EmployeesTabs active="crew" />
      <Card>
        <CardHeader>
          <CardTitle>Invite crew</CardTitle>
          <CardDescription>Crew can only sign in once you invite them.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm defaultRate={data?.defaultWage ?? 15} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Hours this week count accepted jobs starting Mon–Sun. Click a name for the payout log.</CardDescription>
        </CardHeader>
        <CardContent className={data?.rows.length ? "p-0 pb-2" : undefined}>
          {error || !data ? (
            <EmptyState icon={Users} title="Couldn't load employees" description={error ?? undefined} />
          ) : data.rows.length === 0 ? (
            <EmptyState icon={Users} title="No one here yet" description="Invite your first crew member above." />
          ) : (
            <EmployeesTable rows={data.rows} />
          )}
        </CardContent>
      </Card>
      {data && data.removed.length > 0 ? (
        <div className="text-sm">
          <Link
            href={showRemoved ? "/admin/employees" : "/admin/employees?removed=1"}
            className="text-ink-muted underline-offset-4 hover:underline"
          >
            {showRemoved ? "Hide removed" : `Show removed (${data.removed.length})`}
          </Link>
        </div>
      ) : null}
      {data && showRemoved && data.removed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Removed</CardTitle>
            <CardDescription>No longer on the schedule and cannot sign in. Past payouts stay on record.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <EmployeesTable rows={data.removed} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
