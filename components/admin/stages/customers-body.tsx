import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ChevronRight, NotebookPen, Search, UserPlus, UserRound } from "lucide-react"
import { usd } from "@/app/admin/money/math"
import { AddCustomerForm } from "@/components/admin/customers/add-customer-form"
import { CustomerContactCard } from "@/components/admin/customers/customer-contact-card"
import { CustomerEditForm } from "@/components/admin/customers/customer-edit-form"
import { CustomersTabs } from "@/components/admin/customers/customers-tabs"
import { day, formatPhone, titleCase } from "@/components/admin/customers/format"
import { LogInteractionForm } from "@/components/admin/customers/log-interaction-form"
import { PriceLogTable } from "@/components/admin/customers/price-log-table"
import { RebookButton } from "@/components/admin/customers/rebook-button"
import { PaidJobForm, RemovePaidJobButton } from "@/components/admin/money/paid-job-form"
import { DeleteQuoteButton } from "@/components/admin/quotes/delete-quote-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Customer, CustomerInteraction, Job, JobStatus, Lead, Message, Quote } from "@/lib/db/types"
import { MANUAL_SOURCE } from "@/lib/ops/manual-jobs"
import { formatDayLabel, formatTimeRange, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { MissingRecord } from "./missing-record"
import { stageHref } from "./stages"

const LIMIT = 200

async function loadList(q: string) {
  const db = requireSupabaseAdmin()
  let query = db.from("customers").select("*").order("created_at", { ascending: false }).limit(LIMIT)
  // PostgREST `or` syntax: strip characters that would break the filter list.
  const term = q.replace(/[,()*%\\:"']/g, " ").trim()
  if (term) {
    const like = `%${term}%`
    const digits = term.replace(/\D/g, "")
    const ors = [`name.ilike.${like}`, `address.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`]
    if (digits.length >= 3 && digits !== term) ors.push(`phone.ilike.%${digits}%`)
    query = query.or(ors.join(","))
  }
  const customers = await query
  if (customers.error) throw new Error(customers.error.message)
  const rows: Customer[] = customers.data ?? []

  const ids = rows.map((c) => c.id)
  const jobs = ids.length
    ? await db.from("jobs").select("customer_id,status,start_at,completed_at,created_at").in("customer_id", ids)
    : { data: [] as { customer_id: string; status: JobStatus; start_at: string | null; completed_at: string | null; created_at: string }[], error: null }
  if (jobs.error) throw new Error(jobs.error.message)

  const last = new Map<string, { when: string; status: JobStatus }>()
  for (const j of jobs.data ?? []) {
    if (j.status === "cancelled") continue
    const when = j.completed_at ?? j.start_at ?? j.created_at
    const prev = last.get(j.customer_id)
    if (!prev || when > prev.when) last.set(j.customer_id, { when, status: j.status })
  }
  return { rows, last }
}

function OptIns({ c }: { c: Customer }) {
  return (
    <span className="flex flex-wrap gap-1">
      {c.email_opt_in ? <Badge variant="secondary">Email</Badge> : null}
      {c.sms_opt_in ? <Badge variant="secondary">SMS</Badge> : null}
      {c.snow_list ? <Badge variant="outline">❄ Snow</Badge> : null}
      {!c.email_opt_in && !c.sms_opt_in && !c.snow_list ? <span className="text-xs text-ink-muted">None</span> : null}
    </span>
  )
}

/**
 * The Customers page body (`/admin/customers`): search, add, log a conversation and the list.
 * `variant="panel"` is the front page's Customers stage: the same, with rows opening the customer on the
 * front page and "+ Add customer" opening the add form inline.
 */
export async function CustomersBody({ q, variant = "page" }: { q: string; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  let data: Awaited<ReturnType<typeof loadList>> | null = null
  let error: string | null = null
  try {
    data = await loadList(q)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const addButton = (
    <Button asChild variant="outline">
      <Link href={panel ? stageHref("customers", { add: "1" }) : "/admin/customers/new"} scroll={panel ? false : undefined}>
        <UserPlus /> {panel ? "+ Add customer" : "Add a customer"}
      </Link>
    </Button>
  )
  const logButton = (
    <Button asChild>
      <Link href="/admin/customers/log">
        <NotebookPen /> Log a conversation
      </Link>
    </Button>
  )
  const clearHref = panel ? stageHref("customers") : "/admin/customers"

  return (
    <div className="space-y-4">
      {panel ? (
        <div className="flex flex-wrap gap-2">
          {addButton}
          {logButton}
        </div>
      ) : (
        <PageHeader
          title="Customers"
          description="Everyone who has asked for a quote or is in the price log."
          actions={
            <>
              {addButton}
              {logButton}
            </>
          }
        />
      )}
      <CustomersTabs active="all" />
      <form method="get" action={panel ? "/admin" : undefined} className="flex max-w-xl gap-2" role="search">
        {panel ? <input type="hidden" name="stage" value="customers" /> : null}
        <Input name="q" defaultValue={q} placeholder="Search name, address, phone or email" aria-label="Search customers" />
        <Button type="submit" variant="outline">
          <Search /> Search
        </Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href={clearHref}>Clear</Link>
          </Button>
        ) : null}
      </form>

      {error || !data ? (
        <EmptyState icon={UserRound} title="Couldn't load customers" description={error ?? undefined} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={q ? "No matches" : "No customers yet"}
          description={q ? `Nothing matches "${q}".` : "Customers are added when someone fills in the quote form, you log a conversation in the price log, or you add them yourself."}
        />
      ) : panel ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink/10">
            {data.rows.map((c) => {
              const last = data!.last.get(c.id)
              return (
                <li key={c.id}>
                  <Link
                    href={stageHref("customers", { id: c.id })}
                    scroll={false}
                    className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-brand-green/10 focus-visible:bg-brand-green/10 sm:px-4"
                  >
                    <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-4">
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{c.name}</span>
                        <span className="block truncate text-xs text-ink-muted">{c.email ?? ""}</span>
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="block truncate text-ink-body">{c.address ?? "No address"}</span>
                        <span className="block text-xs text-ink-muted">
                          {[c.phone ? formatPhone(c.phone) : null, last ? `Last job ${day(last.when)} · ${titleCase(last.status)}` : "No jobs yet"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <OptIns c={c} />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
          {data.rows.length >= LIMIT ? (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">Showing the newest {LIMIT}. Search to narrow it down.</p>
          ) : null}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Address</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead>Opt-ins</TableHead>
                <TableHead className="hidden lg:table-cell">Last job</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((c) => {
                const last = data!.last.get(c.id)
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-muted">{c.email ?? ""}</p>
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] truncate md:table-cell">{c.address ?? "—"}</TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">{c.phone ? formatPhone(c.phone) : "—"}</TableCell>
                    <TableCell>
                      <OptIns c={c} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {last ? `${day(last.when)} · ${titleCase(last.status)}` : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {data.rows.length >= LIMIT ? (
            <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink-muted">Showing the newest {LIMIT}. Search to narrow it down.</p>
          ) : null}
        </Card>
      )}
    </div>
  )
}

/** "Add a customer" card (`/admin/customers/new`, and inline in the front page's Customers stage). */
export function AddCustomerCard({ variant = "page" }: { variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={panel ? stageHref("customers") : "/admin/customers"} scroll={panel ? false : undefined}>
          <ArrowLeft aria-hidden="true" /> {panel ? "All customers" : "Customers"}
        </Link>
      </Button>
      {panel ? null : <PageHeader title="Add a customer" description="Put someone on file you've done work for, or plan to." />}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">{panel ? "Add a customer" : "Who they are"}</CardTitle>
          <CardDescription>
            Only the name is required. Their page opens next, where you can add a paid job or fill in more later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddCustomerForm detailHref={panel ? "/admin?stage=customers&id=" : undefined} />
        </CardContent>
      </Card>
    </div>
  )
}

async function loadCustomer(id: string) {
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

  // Jobs added by hand ("Add a paid job") can be removed again; this maps them to their quote.
  const manualLeads = new Set((leads.data ?? []).filter((l) => l.source === MANUAL_SOURCE).map((l) => l.id))
  const manualQuoteIds = new Set((quotes.data ?? []).filter((q) => manualLeads.has(q.lead_id)).map((q) => q.id))

  return {
    customer: customer.data,
    manualQuoteIds,
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

/**
 * One customer (`/admin/customers/[id]`): contact, preferences, price log, add a paid job, and their
 * jobs, quotes, leads and messages. `variant="panel"` is the same inside the front page's Customers
 * stage, plus Rebook (back into Leads as a new lead) and a delete that names everything it removes.
 * Calls `notFound()` for a bad or missing id.
 */
export async function CustomerDetailBody({ id, variant = "page" }: { id: string; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  if (!/^[0-9a-f-]{36}$/i.test(id)) return panel ? <MissingRecord stage="customers" what="customer" /> : notFound()
  let data: Awaited<ReturnType<typeof loadCustomer>> = null
  let error: string | null = null
  try {
    data = await loadCustomer(id)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (!error && !data) return panel ? <MissingRecord stage="customers" what="customer" /> : notFound()
  const today = localDate(new Date())

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={panel ? stageHref("customers") : "/admin/customers"} scroll={panel ? false : undefined}>
          <ArrowLeft /> {panel ? "All customers" : "Customers"}
        </Link>
      </Button>
      {error || !data ? (
        <EmptyState icon={UserRound} title="Couldn't load this customer" description={error ?? undefined} />
      ) : (
        <>
          <PageHeader
            as={panel ? "h3" : "h1"}
            title={data.customer.name}
            description={data.customer.address ?? "No address on file"}
            actions={panel ? <RebookButton customerId={data.customer.id} leadHref="/admin?stage=leads&id=" /> : undefined}
          />
          <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
            <CustomerContactCard
              id={data.customer.id}
              initial={{
                name: data.customer.name,
                email: data.customer.email,
                phone: data.customer.phone,
                address: data.customer.address,
                parcel_id: data.customer.parcel_id,
              }}
              since={day(data.customer.created_at)}
              counts={{ jobs: data.jobs.length, quotes: data.quotes.length, leads: data.leads.length }}
              afterDeleteHref={panel ? stageHref("customers") : undefined}
              inlineDeleteError={panel}
              fullDeleteWarning={panel}
            />
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a paid job</CardTitle>
            </CardHeader>
            <CardContent>
              <PaidJobForm today={today} customer={{ id: data.customer.id, name: data.customer.name }} />
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
                  <TableHead className="text-right">
                    <span className="sr-only">Remove</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap">
                      {j.start_at && j.end_at
                        ? `${formatDayLabel(new Date(j.start_at))}, ${formatTimeRange(new Date(j.start_at), new Date(j.end_at))}`
                        : j.completed_at
                          ? day(j.completed_at)
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
                    <TableCell className="text-right">
                      {j.quote_id && data!.manualQuoteIds.has(j.quote_id) ? (
                        <RemovePaidJobButton quoteId={j.quote_id} label={`the job paid ${day(j.paid_at)}`} />
                      ) : null}
                    </TableCell>
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
                  <TableHead className="text-right">
                    <span className="sr-only">Delete</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="whitespace-nowrap">
                      {panel ? (
                        <Link href={stageHref("quotes", { id: q.id })} scroll={false} className="underline-offset-4 hover:underline">
                          {day(q.created_at)}
                        </Link>
                      ) : (
                        day(q.created_at)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(q.status)}>{titleCase(q.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-ink">{usd(Number(q.price_total))}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{usd(Number(q.labor_total))}</TableCell>
                    <TableCell className="hidden md:table-cell">{day(q.sent_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{day(q.accepted_at)}</TableCell>
                    <TableCell className="text-right">
                      <DeleteQuoteButton quoteId={q.id} customerName={data!.customer.name} amount={Number(q.price_total)} paid={!!q.paid_at} compact />
                    </TableCell>
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
                    <TableCell className="whitespace-nowrap">
                      {panel ? (
                        <Link href={stageHref("leads", { id: l.id })} scroll={false} className="underline-offset-4 hover:underline">
                          {day(l.created_at)}
                        </Link>
                      ) : (
                        day(l.created_at)
                      )}
                    </TableCell>
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
