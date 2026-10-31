import Link from "next/link"
import { CalendarClock, Users, Wallet } from "lucide-react"
import { usd } from "@/app/admin/money/math"
import { calendarDate } from "@/components/admin/inbox/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CrewAvailability, CrewException } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { loadEmployees } from "./employees-body"
import { freeOn, upcomingWeekend } from "./weekend"

/**
 * The front page's Crew stage: the team with who can work this Saturday and Sunday (weekly hours minus
 * approved time off, plus approved extra days), hours this week and pay owed. Uses the Employees page's
 * loader for the numbers.
 */
export async function CrewPanel() {
  const { sat, sun } = upcomingWeekend()
  let data: Awaited<ReturnType<typeof loadEmployees>> | null = null
  let blocks: CrewAvailability[] = []
  let exceptions: CrewException[] = []
  let pending = 0
  let error: string | null = null
  try {
    const db = requireSupabaseAdmin()
    const [employees, b, e, p] = await Promise.all([
      loadEmployees(),
      db.from("crew_availability").select("*"),
      db.from("crew_exceptions").select("*").eq("status", "approved").lte("date_from", sun).gte("date_to", sat),
      db.from("crew_exceptions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ])
    data = employees
    blocks = check(b, "crew availability") ?? []
    exceptions = check(e, "crew exceptions") ?? []
    pending = p.error ? 0 : (p.count ?? 0)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const links = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" className="h-11 sm:h-9">
        <Link href="/admin/availability">
          <CalendarClock aria-hidden="true" /> Availability
          {pending ? <Badge variant="warning">{pending} pending</Badge> : null}
        </Link>
      </Button>
      <Button asChild variant="outline" className="h-11 sm:h-9">
        <Link href="/admin/employees">
          <Wallet aria-hidden="true" /> Payouts
        </Link>
      </Button>
    </div>
  )

  if (error || !data) {
    return (
      <div className="space-y-3">
        {links}
        <EmptyState icon={Users} title="Couldn't load the crew" description={error ?? undefined} />
      </div>
    )
  }

  const crew = data.rows.filter((r) => r.role === "crew")
  const freeCell = (id: string, date: string, paused: boolean) =>
    paused ? (
      <Badge variant="outline">Paused</Badge>
    ) : freeOn(id, date, blocks, exceptions) ? (
      <Badge variant="success">Free</Badge>
    ) : (
      <span className="text-xs text-ink-muted">Off</span>
    )

  return (
    <div className="space-y-3">
      {links}
      {crew.length ? (
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sat {calendarDate(sat).split(", ")[1]}</TableHead>
                <TableHead>Sun {calendarDate(sun).split(", ")[1]}</TableHead>
                <TableHead className="text-right">This week</TableHead>
                <TableHead className="text-right">Pay owed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crew.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/admin/employees/${c.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                      {c.name || "Unnamed"}
                    </Link>
                    <p className="text-xs text-ink-muted">{c.phone ?? c.email ?? ""}</p>
                  </TableCell>
                  <TableCell>{freeCell(c.id, sat, c.paused)}</TableCell>
                  <TableCell>{freeCell(c.id, sun, c.paused)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.hoursThisWeek.toFixed(1)}h</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.cashOwed > 0 ? <span className="font-semibold text-ink">{usd(c.cashOwed)}</span> : <span className="text-ink-muted">{usd(0)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Users} title="No crew yet" description="Invite crew from the Employees page." />
      )}
    </div>
  )
}
