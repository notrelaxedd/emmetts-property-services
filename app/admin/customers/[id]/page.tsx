import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, UserRound } from "lucide-react"
import { usd } from "@/app/admin/money/math"
import { CustomerContactForm } from "@/components/admin/customers/customer-contact-form"
import { CustomerEditForm } from "@/components/admin/customers/customer-edit-form"
import { day, titleCase } from "@/components/admin/customers/format"
import { LogInteractionForm } from "@/components/admin/customers/log-interaction-form"
import { PriceLogTable } from "@/components/admin/customers/price-log-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireOwner } from "@/lib/auth/session"
import type { CustomerInteraction, Job, Lead, Message, Quote } from "@/lib/db/types"
import { formatDayLabel, formatTimeRange, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Customer log" }

async function load(id: string) {
  const db = requireSupabaseAdmin()
  const customer = await db.from("customers").select("*").eq("id", id).maybeSingle()
  if (customer.error) throw new Error(customer.error.message)
  if (!customer.data) return null

  const [leads, quotes, jobs, messages, services, interactions] = await Promise.all([
    db.from("leads").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("quotes").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("jobs").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("messages").select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("services").select("id,name"),
    db
      .from("customer_interactions")
      .select("*")
      .eq("customer_id", id)
      .order("talked_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ])
  for (const r of [leads, quotes, jobs, messages, services, interactions]) if (r.error) throw new Error(r.error.message)

  const jobIds = (jobs.data ?? []).map((j) => j.id)
  const assignments = jobIds.length
    ? await db.from("job_assignments").select("job_id,crew_id,status").in("job_id", jobIds).not("status", "in", "(declined,dropped)")
    : { data: [] as { job_id: string; crew_id: string; status: string }[], error: null }
  if (assignments.error) throw new Error(assignments.error.message)
  const crewIds = Array.from(new Set((assignments.data ?? []).map((a) => a.crew_id)))
  const crew = crewIds.length ? await db.from("profiles").select("id,name").in("id", crewIds) : { data: [] as { id: string; name: string }[], error: null }
  if (crew.error) throw new Error(crew.error.message)
  const crewName = new Map((crew.data ?? []).map((c) => [c.id, c.name]))
  const crewByJob = new Map<string, string[]>()
  for (const a of assignments.data ?? []) {
    crewByJob.set(a.job_id, [...(crewByJob.get(a.job_id) ?? []), crewName.get(a.crew_id) ?? "Crew"])
  }

  return {
    customer: customer.data,
    leads: (leads.data ?? []) as Lead[],
    quotes: (quotes.data ?? []) as Quote[],
    jobs: (jobs.data ?? []) as Job[],
    messages: (messages.data ?? []) as Message[],
    interactions: ((interactions.data ?? []) as CustomerInteraction[]).map((e) => ({
      ...e,
      price: e.price === null ? null : Number(e.price),
    })),
    serviceName: new Map((services.data ?? []).map((s) => [s.id, s.name])),
    crewByJob,
  }
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Badge variant="outline">{count}</Badge>
      </CardHeader>
      <CardContent className={count ? "p-0 pb-2" : undefined}>
        {count ? children : <p className="text-sm text-ink-muted">None yet.</p>}
      </CardContent>
    </Card>
  )
}

const statusVariant = (s: string) =>
  s === "accepted" || s === "booked" || s === "done" || s === "sent" || s === "won"
    ? ("success" as const)
    : s === "failed" || s === "declined" || s === "cancelled" || s === "lost" || s === "expired"
      ? ("destructive" as const)
      : s === "needs_owner" || s === "proposed" || s === "queued"
        ? ("warning" as const)
        : ("outline" as const)

export default async function CustomerPage({ params }: { params: { id: string } }) {
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
  const today = localDate(new Date())

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/customers">
          <ArrowLeft /> Customers
        </Link>
      </Button>
      {error || !data ? (
        <EmptyState icon={UserRound} title="Couldn't load this customer" description={error ?? undefined} />
      ) : (
        <>
          <PageHeader title={data.customer.name} description={data.customer.address ?? "No address on file"} />
          <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomerContactForm
                  id={data.customer.id}
                  initial={{
                    name: data.customer.name,
                    email: data.customer.email,
                    phone: data.customer.phone,
                    address: data.customer.address,
                    parcel_id: data.customer.parcel_id,
                  }}
                  since={day(data.customer.created_at)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preferences &amp; property</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomerEditForm
                  id={data.customer.id}
                  initial={{
                    notes: data.customer.notes,
                    email_opt_in: data.customer.email_opt_in,
                    sms_opt_in: data.customer.sms_opt_in,
                    snow_list: data.customer.snow_list,
                    lot_acres: data.customer.lot_acres === null ? null : Number(data.customer.lot_acres),
                    tree_cover: data.customer.tree_cover,
                  }}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Price log</CardTitle>
              <Badge variant="outline">{data.interactions.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.interactions.length ? (
                <div className="-mx-4 border-b border-ink/10 pb-2">
                  <PriceLogTable rows={data.interactions} today={today} />
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Nothing logged yet.</p>
              )}
              <LogInteractionForm today={today} customer={{ id: data.customer.id, name: data.customer.name }} />
            </CardContent>
          </Card>

          <Section title="Jobs" count={data.jobs.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Crew</TableHead>
                  <TableHead className="hidden sm:table-cell">Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap">
                      {j.start_at && j.end_at
                        ? `${formatDayLabel(new Date(j.start_at))}, ${formatTimeRange(new Date(j.start_at), new Date(j.end_at))}`
                        : "Not scheduled"}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant={statusVariant(j.status)}>{titleCase(j.status)}</Badge>
                        {j.weather_hold ? <Badge variant="outline">⛈ Hold</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell>{(data!.crewByJob.get(j.id) ?? []).join(", ") || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{j.paid ? day(j.paid_at) : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Quotes" count={data.quotes.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Labor</TableHead>
                  <TableHead className="hidden md:table-cell">Sent</TableHead>
                  <TableHead className="hidden md:table-cell">Accepted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="whitespace-nowrap">{day(q.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(q.status)}>{titleCase(q.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-ink">{usd(Number(q.price_total))}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{usd(Number(q.labor_total))}</TableCell>
                    <TableCell className="hidden md:table-cell">{day(q.sent_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{day(q.accepted_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Leads" count={data.leads.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Asked for</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{day(l.created_at)}</TableCell>
                    <TableCell>{l.source}</TableCell>
                    <TableCell className="max-w-[22rem]">
                      <span className="block truncate">
                        {[...l.requested_service_ids.map((s) => data!.serviceName.get(s) ?? "Service"), l.custom_request ? `"${l.custom_request}"` : null]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(l.status)}>{titleCase(l.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Messages" count={data.messages.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="hidden sm:table-cell">Channel</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.messages.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{day(m.sent_at ?? m.created_at)}</TableCell>
                    <TableCell>{titleCase(m.kind)}</TableCell>
                    <TableCell className="hidden uppercase sm:table-cell">{m.channel}</TableCell>
                    <TableCell className="max-w-[22rem]">
                      <span className="block truncate" title={m.body}>
                        {m.subject ?? m.body.slice(0, 80)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(m.status)} title={m.error ?? undefined}>
                        {titleCase(m.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </>
      )}
    </div>
  )
}
