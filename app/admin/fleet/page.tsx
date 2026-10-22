import { Cpu, ListChecks } from "lucide-react"
import { usd } from "@/app/admin/money/math"
import { AutoRefresh } from "@/components/admin/fleet/auto-refresh"
import { RequeueStaleButton, RetryButton } from "@/components/admin/fleet/task-actions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { FleetTask, FleetTaskStatus, FleetWorker } from "@/lib/db/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata = { title: "Fleet" }

const ONLINE_MS = 2 * 60 * 1000

function ago(iso: string | null, now: number): string {
  if (!iso) return "never"
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function when(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (t > now) {
    const m = Math.round((t - now) / 60000)
    return m < 60 ? `in ${m}m` : m < 1440 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`
  }
  return ago(iso, now)
}

function pct(n: number | null): string {
  return n === null || n === undefined ? "—" : `${Math.round(Number(n))}%`
}

const STATUS_VARIANT: Record<FleetTaskStatus, "success" | "warning" | "destructive" | "outline"> = {
  done: "success",
  running: "warning",
  failed: "destructive",
  queued: "outline",
}

async function load() {
  const db = requireSupabaseAdmin()
  const [workers, tasks, spend, counts] = await Promise.all([
    db.from("fleet_workers").select("*").order("name"),
    db.from("fleet_tasks").select("*").order("created_at", { ascending: false }).limit(50),
    db.rpc("ai_spend_this_month"),
    db.from("fleet_tasks").select("status").in("status", ["queued", "running", "failed"]),
  ])
  for (const r of [workers, tasks]) if (r.error) throw new Error(r.error.message)
  const byStatus = { queued: 0, running: 0, failed: 0 }
  for (const t of counts.data ?? []) if (t.status in byStatus) byStatus[t.status as keyof typeof byStatus]++
  return {
    workers: (workers.data ?? []) as FleetWorker[],
    tasks: (tasks.data ?? []) as FleetTask[],
    aiSpend: spend.error ? null : Number(spend.data ?? 0) || 0,
    byStatus,
  }
}

export default async function FleetPage() {
  await requireOwner()
  const now = Date.now()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  // Offline workers are not listed: a box that stops heartbeating drops off (the host also deletes its row).
  const workers = data?.workers.filter((w) => w.last_heartbeat && now - Date.parse(w.last_heartbeat) < ONLINE_MS) ?? []

  return (
    <div className="space-y-5">
      <PageHeader title="Fleet" description="Worker boxes, their health, and the task queue." actions={<AutoRefresh seconds={30} />} />
      {error || !data ? (
        <EmptyState icon={Cpu} title="Couldn't load the fleet" description={error ?? undefined} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Workers online" value={workers.length} deltaTone={workers.length ? "up" : "down"} />
            <Stat label="AI spend this month" value={data.aiSpend === null ? "—" : usd(data.aiSpend)} />
            <Stat label="Queued / running" value={`${data.byStatus.queued} / ${data.byStatus.running}`} />
            <Stat label="Failed tasks" value={data.byStatus.failed} deltaTone={data.byStatus.failed ? "down" : "neutral"} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Workers</CardTitle>
            </CardHeader>
            <CardContent className={workers.length ? "p-0 pb-2" : undefined}>
              {workers.length === 0 ? (
                <EmptyState
                  icon={Cpu}
                  title="No workers online"
                  description="Workers appear while they are heartbeating and drop off after 2 minutes of silence (see fleet/README.md)."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">CPU</TableHead>
                      <TableHead className="text-right">RAM</TableHead>
                      <TableHead className="text-right">Temp</TableHead>
                      <TableHead>Current task</TableHead>
                      <TableHead>Last error</TableHead>
                      <TableHead className="hidden lg:table-cell">Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workers.map((w) => {
                      const hot = w.temp_c !== null && Number(w.temp_c) >= 75
                      return (
                        <TableRow key={w.id}>
                          <TableCell>
                            <p className="font-medium text-ink">{w.name}</p>
                            <p className="text-xs text-ink-muted">{w.role}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="success">Online</Badge>
                            <p className="mt-0.5 text-xs text-ink-muted">{ago(w.last_heartbeat, now)}</p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{pct(w.cpu)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(w.ram)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", hot && "font-semibold text-destructive")}>
                            {w.temp_c === null ? "—" : `${Math.round(Number(w.temp_c))}°C`}
                          </TableCell>
                          <TableCell className="max-w-[12rem] truncate">{w.current_task ?? <span className="text-ink-muted">idle</span>}</TableCell>
                          <TableCell className="max-w-[16rem]">
                            {w.last_error ? (
                              <span className="block truncate text-destructive" title={w.last_error}>
                                {w.last_error}
                              </span>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-xs text-ink-muted lg:table-cell">{w.version ?? "—"}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Recent tasks</CardTitle>
              <RequeueStaleButton />
            </CardHeader>
            <CardContent className={data.tasks.length ? "p-0 pb-2" : undefined}>
              {data.tasks.length === 0 ? (
                <EmptyState icon={ListChecks} title="No tasks yet" description="Quotes, schedules, ads and follow-ups queue up here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Worker</TableHead>
                      <TableHead className="text-right">Tries</TableHead>
                      <TableHead className="hidden md:table-cell">Run after</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tasks.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-medium text-ink">{t.type.replace(/_/g, " ")}</p>
                          <p className="text-xs text-ink-muted">{ago(t.created_at, now)}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{t.worker ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.attempts}/{t.max_attempts}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell">{when(t.run_after, now)}</TableCell>
                        <TableCell className="max-w-[18rem]">
                          {t.error ? (
                            <span className="block truncate text-destructive" title={t.error}>
                              {t.error}
                            </span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{t.status === "failed" ? <RetryButton id={t.id} /> : null}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
