import { CalendarClock, Inbox, Users } from "lucide-react"
import { CrewBlocks, type CrewBlocksRow } from "@/components/admin/availability/crew-blocks"
import { OwnerExceptions } from "@/components/admin/availability/owner-exceptions"
import { OwnerWindowsEditor } from "@/components/admin/availability/owner-windows-editor"
import { PendingRequests, type PendingRequest } from "@/components/admin/availability/pending-requests"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { addDays, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Availability" }

async function load(today: string) {
  const db = requireSupabaseAdmin()
  const [windows, exceptions, crew, blocks, requests] = await Promise.all([
    db.from("owner_windows").select("weekday,start_time,end_time").order("weekday").order("start_time"),
    db.from("owner_exceptions").select("id,date,closed,start_time,end_time,note").gte("date", addDays(today, -7)).order("date"),
    db.from("profiles").select("id,name,paused,max_hours_week").eq("role", "crew").is("removed_at", null).order("name"),
    db.from("crew_availability").select("crew_id,weekday,start_time,end_time"),
    db.from("crew_exceptions").select("*").eq("status", "pending").order("date_from"),
  ])
  for (const r of [windows, exceptions, crew, blocks, requests]) if (r.error) throw new Error(r.error.message)

  const names = new Map((crew.data ?? []).map((c) => [c.id, c.name]))
  const missing = Array.from(new Set((requests.data ?? []).map((r) => r.crew_id).filter((id) => !names.has(id))))
  if (missing.length) {
    const more = await db.from("profiles").select("id,name").in("id", missing)
    for (const p of more.data ?? []) names.set(p.id, p.name)
  }

  const crewRows: CrewBlocksRow[] = (crew.data ?? []).map((c) => ({
    id: c.id,
    name: c.name || "Unnamed",
    paused: c.paused,
    maxHours: Number(c.max_hours_week),
    blocks: (blocks.data ?? []).filter((b) => b.crew_id === c.id),
  }))
  const pending: PendingRequest[] = (requests.data ?? []).map((r) => ({
    id: r.id,
    crewName: names.get(r.crew_id) ?? "Crew member",
    kind: r.kind,
    date_from: r.date_from,
    date_to: r.date_to,
    start_time: r.start_time,
    end_time: r.end_time,
    note: r.note,
    created_at: r.created_at,
  }))
  return { windows: windows.data ?? [], exceptions: exceptions.data ?? [], crewRows, pending }
}

export default async function AvailabilityPage() {
  await requireOwner()
  const today = localDate(new Date())
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(today)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Availability" description="When you can run jobs, and when your crew can work." />
      {error || !data ? (
        <EmptyState icon={CalendarClock} title="Couldn't load availability" description={error ?? undefined} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Pending requests</CardTitle>
              <CardDescription>Time off and extra days your crew asked for. Approving re-runs the scheduler.</CardDescription>
            </CardHeader>
            <CardContent className={data.pending.length ? "p-0 pb-2" : undefined}>
              {data.pending.length ? (
                <PendingRequests rows={data.pending} />
              ) : (
                <EmptyState icon={Inbox} title="No pending requests" description="New time-off requests show up here." />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Your open hours</CardTitle>
                <CardDescription>
                  The scheduler only books jobs inside these windows (America/New_York). Add more than one block per day for a split day.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OwnerWindowsEditor initial={data.windows} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Days off &amp; custom hours</CardTitle>
                <CardDescription>One-off dates that replace your usual hours.</CardDescription>
              </CardHeader>
              <CardContent>
                <OwnerExceptions rows={data.exceptions} today={today} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Crew weekly hours</CardTitle>
              <CardDescription>Set by each crew member in the crew app. Read-only here.</CardDescription>
            </CardHeader>
            <CardContent className={data.crewRows.length ? "p-0 pb-2" : undefined}>
              {data.crewRows.length ? (
                <CrewBlocks rows={data.crewRows} />
              ) : (
                <EmptyState icon={Users} title="No crew yet" description="Invite crew from the Employees page." />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
