import Link from "next/link"
import { ArrowLeft, Map as MapIcon } from "lucide-react"
import { FlyerMap, type MapLead, type MapWorker } from "@/components/admin/flyers/flyer-map"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireOwner } from "@/lib/auth/session"
import { loadFlyerFunnels } from "@/lib/flyers/load"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Flyer map" }

/** Most recent flyer leads shown as pins. */
const MAX_PINS = 500

async function load() {
  const db = requireSupabaseAdmin()
  const [workerRows, { leads }] = await Promise.all([
    db.from("flyer_workers").select("id,name,code,removed_at").order("name"),
    loadFlyerFunnels(db),
  ])
  const allWorkers = check(workerRows, "flyer workers") ?? []
  const nameById = new Map(allWorkers.map((w) => [w.id, w.name]))
  const workers: MapWorker[] = allWorkers.filter((w) => !w.removed_at).map((w) => ({ id: w.id, name: w.name, code: w.code }))

  const recent = leads.slice(0, MAX_PINS)
  const custIds = Array.from(new Set(recent.map((l) => l.customer_id)))
  const customers: { id: string; name: string; address: string | null; lat: number | null; lng: number | null }[] = []
  for (let i = 0; i < custIds.length; i += 100) {
    customers.push(...(check(await db.from("customers").select("id,name,address,lat,lng").in("id", custIds.slice(i, i + 100)), "customers") ?? []))
  }
  const custById = new Map(customers.map((c) => [c.id, c]))
  const pins: MapLead[] = []
  for (const l of recent) {
    const c = custById.get(l.customer_id)
    if (!c || c.lat === null || c.lng === null || l.status === "spam") continue
    pins.push({
      id: l.id,
      lat: c.lat,
      lng: c.lng,
      label: c.address ? `${c.name} · ${c.address}` : c.name,
      booked: l.booked,
      worker: nameById.get(l.flyer_worker_id) ?? "a flyer worker",
    })
  }
  return { workers, pins }
}

export default async function FlyerMapPage() {
  await requireOwner()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/employees/flyers">
          <ArrowLeft /> Flyer workers
        </Link>
      </Button>
      <PageHeader title="Flyer map" description="Check off the streets that have had flyers. Green for 30 days, then they’re due again." />
      {error || !data ? (
        <EmptyState icon={MapIcon} title="Couldn't load the flyer map" description={error ?? undefined} />
      ) : (
        <FlyerMap workers={data.workers} leads={data.pins} today={localDate(new Date())} />
      )}
    </div>
  )
}
