import type { Metadata } from "next"
import { AdminShell } from "@/components/admin/shell"
import type { FleetSummary } from "@/components/admin/fleet-panel"
import { ToastProvider } from "@/components/ui/toast"
import { requireOwner } from "@/lib/auth/session"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: { default: "Owner console", template: "%s | Owner console" },
  robots: { index: false, follow: false },
}

// Always render per request: the sidebar counts must be live and the session is cookie-based.
export const dynamic = "force-dynamic"

const ONLINE_WINDOW_MS = 2 * 60 * 1000

/** Sidebar numbers. Every query is guarded: missing env or tables render 0, never an error page. */
async function loadSidebarData(): Promise<{ pendingCount: number; fleetSummary: FleetSummary }> {
  const empty = { pendingCount: 0, fleetSummary: { online: 0, total: 0, aiSpend: 0 } }
  try {
    const supabase = createSupabaseServerClient()
    if (!supabase) return empty

    const [pending, workers, spend] = await Promise.all([
      supabase.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("fleet_workers").select("last_heartbeat"),
      supabase.rpc("ai_spend_this_month"),
    ])

    const cutoff = Date.now() - ONLINE_WINDOW_MS
    const rows = workers.error ? [] : (workers.data ?? [])
    const online = rows.filter((w) => w.last_heartbeat && new Date(w.last_heartbeat).getTime() >= cutoff).length

    return {
      pendingCount: pending.error ? 0 : (pending.count ?? 0),
      fleetSummary: {
        online,
        total: rows.length,
        aiSpend: spend.error ? 0 : Number(spend.data ?? 0) || 0,
      },
    }
  } catch {
    return empty
  }
}

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOwner()
  const { pendingCount, fleetSummary } = await loadSidebarData()

  return (
    <ToastProvider>
      <AdminShell pendingCount={pendingCount} fleetSummary={fleetSummary} userName={session.profile.name.split(" ")[0]}>
        {children}
      </AdminShell>
    </ToastProvider>
  )
}
