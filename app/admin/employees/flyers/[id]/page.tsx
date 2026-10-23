import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ArrowLeft, Download, Megaphone, Printer, QrCode, Wallet } from "lucide-react"
import { CopyButton } from "@/components/admin/inbox/copy-button"
import { BatchesTable, LogBatchForm, MarkAllFlyersPaidButton, type BatchRow } from "@/components/admin/flyers/batches"
import { perFlyer } from "@/components/admin/flyers/format"
import { WorkerSettings } from "@/components/admin/flyers/worker-settings"
import { LeadStatusBadge } from "@/components/admin/leads/status-badges"
import { usd } from "@/app/admin/money/math"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import type { LeadStatus } from "@/lib/db/types"
import { flyerUrl } from "@/lib/flyers/codes"
import { loadFlyerFunnels } from "@/lib/flyers/load"
import { emptyFunnel, percent } from "@/lib/flyers/stats"
import { check } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { siteConfig } from "@/lib/site-config"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Flyer worker" }

async function load(id: string) {
  const db = requireSupabaseAdmin()
  const worker = check(await db.from("flyer_workers").select("*").eq("id", id).maybeSingle(), "flyer worker")
  if (!worker) return null
  const [batches, { funnels, leads }] = await Promise.all([
    db.from("flyer_batches").select("*").eq("flyer_worker_id", id).order("handed_out_on", { ascending: false }).order("created_at", { ascending: false }),
    loadFlyerFunnels(db, id),
  ])
  const custIds = Array.from(new Set(leads.map((l) => l.customer_id))).slice(0, 100)
  const customers = custIds.length
    ? check(await db.from("customers").select("id,name,address").in("id", custIds), "customers") ?? []
    : []
  const custById = new Map(customers.map((c) => [c.id, c]))

  const rows: BatchRow[] = (check(batches, "batches") ?? []).map((b) => ({
    id: b.id,
    date: b.handed_out_on,
    area: b.area,
    count: Number(b.flyer_count),
    rate: Number(b.rate),
    amount: Number(b.amount),
    paidAt: b.paid_at ? localDate(new Date(b.paid_at)) : null,
  }))
  return {
    worker,
    rows,
    funnel: funnels.get(id) ?? emptyFunnel(),
    leads: leads.slice(0, 100).map((l) => {
      const c = custById.get(l.customer_id)
      return { id: l.id, date: localDate(new Date(l.created_at)), status: l.status as LeadStatus, booked: l.booked, label: c ? `${c.name}${c.address ? ` · ${c.address}` : ""}` : "Lead" }
    }),
  }
}

export default async function FlyerWorkerPage({ params }: { params: { id: string } }) {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound()
  let data: Awaited<ReturnType<typeof load>> = null
  let error: string | null = null
  try {
    data = await load(params.id)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (!error && !data) notFound()

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href="/admin/employees/flyers">
        <ArrowLeft /> Flyer workers
      </Link>
    </Button>
  )
  if (error || !data) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={Megaphone} title="Couldn't load this flyer worker" description={error ?? undefined} />
      </div>
    )
  }

  const { worker, funnel } = data
  const flyerHref = `/admin/employees/flyers/${worker.id}/flyer`
  const qrTarget = flyerUrl(siteConfig.url, worker.code)
  // A QR printed from a preview or local build would send people to the wrong site.
  const urlLooksWrong = /localhost|127\.0\.0\.1|\.vercel\.app/.test(qrTarget)
  const rate = Number(worker.rate_per_flyer)

  return (
    <div className="space-y-5">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {worker.name}
            <Badge variant="outline" className="font-mono text-sm">
              {worker.code}
            </Badge>
            {worker.removed_at ? <Badge variant="warning">Removed</Badge> : null}
          </span>
        }
        description={[worker.phone, `${perFlyer(rate)} per flyer`].filter(Boolean).join(" · ")}
        actions={<MarkAllFlyersPaidButton workerId={worker.id} owed={funnel.owed} />}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Flyers out" value={funnel.flyersOut.toLocaleString()} />
        <Stat label="Scans" value={funnel.scans.toLocaleString()} hint={`${percent(funnel.scanRate)} of flyers`} />
        <Stat label="Quote requests" value={funnel.requests.toLocaleString()} />
        <Stat label="Jobs booked" value={funnel.booked.toLocaleString()} hint={`${percent(funnel.closeRate)} of requests`} />
        <Stat label="Conversion" value={percent(funnel.conversion)} hint="booked ÷ flyers out" />
        <Stat label="Owed" value={usd(funnel.owed)} hint={`${usd(funnel.paid)} paid`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Their flyer</CardTitle>
            <CardDescription>Fall Clean Up flyer with {worker.name}’s QR code and code.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated per worker by the route next door */}
            <img
              src={`${flyerHref}?format=preview`}
              alt={`Flyer with ${worker.name}'s QR code`}
              width={700}
              height={906}
              className="h-auto w-full rounded-md border border-ink/10"
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={`${flyerHref}?format=pdf`} target="_blank" rel="noopener">
                  <Printer /> Print (PDF)
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`${flyerHref}?format=png&download=1`}>
                  <Download /> PNG
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`${flyerHref}?format=qr&download=1`}>
                  <QrCode /> QR only
                </a>
              </Button>
            </div>
            <div className="space-y-1.5 text-sm">
              <p className="text-ink-muted">The QR code opens:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-paper px-2 py-1 text-xs text-ink">{qrTarget}</code>
                <CopyButton text={qrTarget} label="Copy link" />
              </div>
            </div>
            {urlLooksWrong ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>
                  This link isn’t your real domain. Set NEXT_PUBLIC_SITE_URL (for example https://eodlawns.com) in Vercel before
                  printing, or these QR codes will point at the wrong site.
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-xs text-ink-muted">
              If someone calls instead of scanning and mentions code {worker.code}, open their lead and credit it to {worker.name}.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Log flyers handed out</CardTitle>
              <CardDescription>Each batch is owed at its own rate until you mark it paid.</CardDescription>
            </CardHeader>
            <CardContent>
              <LogBatchForm workerId={worker.id} defaultRate={rate} today={localDate(new Date())} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Batches and pay</CardTitle>
            </CardHeader>
            <CardContent className={data.rows.length ? "p-0 pb-2" : undefined}>
              {data.rows.length ? (
                <BatchesTable rows={data.rows} />
              ) : (
                <EmptyState icon={Wallet} title="No batches yet" description="Log the flyers you hand them and their pay shows up here." />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quote requests from their flyers</CardTitle>
            </CardHeader>
            <CardContent>
              {data.leads.length ? (
                <ul className="divide-y divide-ink/10">
                  {data.leads.map((l) => (
                    <li key={l.id}>
                      <Link href={`/admin/leads/${l.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                        <span className="min-w-0 truncate text-sm text-ink">
                          <span className="mr-2 text-ink-muted">{l.date}</span>
                          {l.label}
                        </span>
                        {l.booked ? <Badge variant="success">Booked</Badge> : <LeadStatusBadge status={l.status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">None yet. Quote requests from {worker.name}’s QR code show up here.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkerSettings worker={{ id: worker.id, name: worker.name, phone: worker.phone, rate, removed: worker.removed_at !== null }} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
