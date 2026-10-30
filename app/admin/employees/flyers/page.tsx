import Link from "next/link"
import { Download, Megaphone, Printer, QrCode } from "lucide-react"
import { EmployeesTabs } from "@/components/admin/employees/employees-tabs"
import { AddFlyerWorkerForm } from "@/components/admin/flyers/add-flyer-worker-form"
import { FlyerWorkersTable, type FlyerWorkerRow } from "@/components/admin/flyers/flyer-workers-table"
import { usd } from "@/app/admin/money/math"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { loadFlyerFunnels } from "@/lib/flyers/load"
import { emptyFunnel, percent, totalFunnel } from "@/lib/flyers/stats"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Flyer workers" }

async function load() {
  const db = requireSupabaseAdmin()
  const [workers, { funnels }] = await Promise.all([
    db.from("flyer_workers").select("*").order("name"),
    loadFlyerFunnels(db),
  ])
  const all: FlyerWorkerRow[] = (check(workers, "flyer workers") ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    phone: w.phone,
    code: w.code,
    rate: Number(w.rate_per_flyer),
    removed: w.removed_at !== null,
    funnel: funnels.get(w.id) ?? emptyFunnel(),
  }))
  return {
    rows: all.filter((r) => !r.removed),
    removed: all.filter((r) => r.removed),
    total: totalFunnel(all.map((r) => r.funnel)),
  }
}

export default async function FlyerWorkersPage({ searchParams }: { searchParams: { removed?: string } }) {
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
      <PageHeader title="Employees" description="Flyer workers: flyers handed out, what they bring in, and what they're owed." />
      <EmployeesTabs active="flyers" />
      {data && (data.rows.length > 0 || data.removed.length > 0) ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Flyers out" value={data.total.flyersOut.toLocaleString()} hint={`${data.total.scans.toLocaleString()} scans`} />
          <Stat label="Jobs booked" value={data.total.booked.toLocaleString()} hint={`from ${data.total.requests.toLocaleString()} quote requests`} />
          <Stat label="Conversion" value={percent(data.total.conversion)} hint="jobs booked ÷ flyers out" />
          <Stat label="Owed" value={usd(data.total.owed)} hint={`${usd(data.total.paid)} paid to date`} />
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Add flyer worker</CardTitle>
          <CardDescription>Default pay is per flyer handed out. You can change it per worker and per batch.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddFlyerWorkerForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Flyer workers</CardTitle>
          <CardDescription>
            Scans are unique people who scanned the QR code. Requests are quote forms sent from their flyer (or credited to them on
            the lead). Booked means the quote was paid and the job isn’t cancelled.
          </CardDescription>
        </CardHeader>
        <CardContent className={data?.rows.length ? "p-0 pb-2" : undefined}>
          {error || !data ? (
            <EmptyState icon={Megaphone} title="Couldn't load flyer workers" description={error ?? undefined} />
          ) : data.rows.length === 0 ? (
            <EmptyState icon={Megaphone} title="No flyer workers yet" description="Add your first one above to get their flyer." />
          ) : (
            <FlyerWorkersTable rows={data.rows} />
          )}
        </CardContent>
      </Card>
      <GenericFlyerCard />
      {data && data.removed.length > 0 ? (
        <div className="text-sm">
          <Link
            href={showRemoved ? "/admin/employees/flyers" : "/admin/employees/flyers?removed=1"}
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
            <CardDescription>Off the list. Their batches, pay and results stay on record, and their flyers still work.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <FlyerWorkersTable rows={data.removed} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/** The same flyer with no worker on it: its QR goes straight to the quote form and credits no one. */
function GenericFlyerCard() {
  const href = "/admin/employees/flyers/generic"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generic flyer</CardTitle>
        <CardDescription>
          The fall lawn cleanup flyer without a worker’s code, for handing out yourself or leaving at a counter. Its QR code opens
          the quote form, and leads from it aren’t credited to anyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated by the route next door */}
        <img
          src={`${href}?format=preview`}
          alt="Generic flyer"
          width={700}
          height={906}
          className="h-auto w-full max-w-[12rem] rounded-md border border-ink/10"
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={`${href}?format=pdf`} target="_blank" rel="noopener">
              <Printer /> Print (PDF)
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`${href}?format=png&download=1`}>
              <Download /> PNG
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`${href}?format=qr&download=1`}>
              <QrCode /> QR only
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
