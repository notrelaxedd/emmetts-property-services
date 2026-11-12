import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ChevronRight, NotebookPen, Search, UserPlus, UserRound } from "lucide-react"
import { usd } from "@/app/admin/money/math"
import { AddCustomerForm } from "@/components/admin/customers/add-customer-form"
import { CommunicatorPicker } from "@/components/admin/customers/communicator-picker"
import { CustomerContactCard } from "@/components/admin/customers/customer-contact-card"
import { CustomerEditForm } from "@/components/admin/customers/customer-edit-form"
import { CustomersTabs } from "@/components/admin/customers/customers-tabs"
import { day, formatPhone, titleCase } from "@/components/admin/customers/format"
import { LogInteractionForm } from "@/components/admin/customers/log-interaction-form"
import { PriceLogTable } from "@/components/admin/customers/price-log-table"
import { RebookButton } from "@/components/admin/customers/rebook-button"
import { ScheduleJobForm } from "@/components/admin/customers/schedule-job-form"
import { PaidJobForm, RemovePaidJobButton } from "@/components/admin/money/paid-job-form"
import { DeleteQuoteButton } from "@/components/admin/quotes/delete-quote-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getSession } from "@/lib/auth/session"
import type { Customer, CustomerInteraction, Job, JobStatus, Lead, Message, Quote } from "@/lib/db/types"
import { loadTeam, parseWho, pickable, whoParam, type TeamMember, type WhoFilter } from "@/lib/ops/communicators"
import { MANUAL_SOURCE } from "@/lib/ops/manual-jobs"
import { formatDayLabel, formatTimeRange, localDate } from "@/lib/scheduler/time"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"
import { MissingRecord } from "./missing-record"
import { stageHref } from "./stages"

const LIMIT = 200

async function loadList(q: string, who: WhoFilter) {
  const db = requireSupabaseAdmin()
  let query = db.from("customers").select("*").order("created_at", { ascending: false }).limit(LIMIT)
  if (who.kind === "none") query = query.is("communicator_id", null)
  if (who.kind === "person") query = query.eq("communicator_id", who.id)
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

  // The "Talking to" filter: everyone who has customers or can be given some, with how many each has.
  const team = await loadTeam(db)
  const countFor = async (id: string | null) => {
    const base = db.from("customers").select("id", { count: "exact", head: true })
    const res = await (id ? base.eq("communicator_id", id) : base.is("communicator_id", null))
    if (res.error) throw new Error(res.error.message)
    return res.count ?? 0
  }
  const [unassigned, ...perPerson] = await Promise.all([countFor(null), ...team.map((m) => countFor(m.id))])
  const counts = new Map(team.map((m, i) => [m.id, perPerson[i]]))
  return { rows, last, team, counts, unassigned }
}

/** Pills to see one person's customers: Everyone, Mine, each teammate with customers, Nobody yet. */
function WhoFilters({
  who,
  meId,
  team,
  counts,
  unassigned,
  href,
}: {
  who: WhoFilter
  meId: string | null
  team: TeamMember[]
  counts: Map<string, number>
  unassigned: number
  href: (who: string | null) => string
}) {
  const others = team.filter((m) => m.id !== meId && ((counts.get(m.id) ?? 0) > 0 || (who.kind === "person" && who.id === m.id)))
  const pills: { key: string; label: string; count?: number; active: boolean; who: string | null }[] = [
    { key: "all", label: "Everyone", active: who.kind === "all", who: null },
    ...(meId ? [{ key: "me", label: "Mine", count: counts.get(meId) ?? 0, active: who.kind === "person" && who.id === meId, who: "me" }] : []),
    ...others.map((m) => ({ key: m.id, label: m.name, count: counts.get(m.id) ?? 0, active: who.kind === "person" && who.id === m.id, who: m.id })),
    { key: "none", label: "Nobody yet", count: unassigned, active: who.kind === "none", who: "none" },
  ]
  return (
    <nav aria-label="Who's talking to them" className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
      <span className="shrink-0 pr-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Talking to</span>
      {pills.map((p) => (
        <Link
          key={p.key}
          href={href(p.who)}
          scroll={false}
          aria-current={p.active ? "true" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
            p.active ? "border-ink bg-ink text-white" : "border-ink/25 bg-white text-ink hover:bg-accent",
          )}
        >
          {p.label}
          {typeof p.count === "number" ? (
            <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", p.active ? "bg-brand-green text-ink" : "bg-gray-light text-ink")}>
              {p.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
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
export async function CustomersBody({ q, who: whoRaw, variant = "page" }: { q: string; who?: string; variant?: "page" | "panel" }) {
  const panel = variant === "panel"
  const meId = (await getSession())?.profile.id ?? null
  const who = parseWho(whoRaw, meId)
  let data: Awaited<ReturnType<typeof loadList>> | null = null
  let error: string | null = null
  try {
    data = await loadList(q, who)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const nameOf = new Map((data?.team ?? []).map((m) => [m.id, m.id === meId ? `${m.name} (you)` : m.name]))
  const listHref = (next: { q?: string; who?: string | null }) => {
    const params = { q: next.q ?? q, who: next.who === undefined ? whoParam(who) : next.who }
    if (panel) return stageHref("customers", params)
    const sp = new URLSearchParams()
    if (params.q) sp.set("q", params.q)
    if (params.who) sp.set("who", params.who)
    const qs = sp.toString()
    return qs ? `/admin/customers?${qs}` : "/admin/customers"
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
  const clearHref = listHref({ q: "" })

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
        {whoParam(who) ? <input type="hidden" name="who" value={whoParam(who)!} /> : null}
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

      {data ? (
        <WhoFilters who={who} meId={meId} team={data.team} counts={data.counts} unassigned={data.unassigned} href={(w) => listHref({ who: w })} />
      ) : null}

      {error || !data ? (
        <EmptyState icon={UserRound} title="Couldn't load customers" description={error ?? undefined} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={q ? "No matches" : who.kind !== "all" ? "Nobody here" : "No customers yet"}
          description={
            q
              ? `Nothing matches "${q}"${who.kind !== "all" ? " for this person" : ""}.`
              : who.kind === "none"
                ? "Every customer has someone talking to them."
                : who.kind === "person"
                  ? `${who.me ? "You aren't" : `${nameOf.get(who.id) ?? "This person"} isn't`} talking to any customers yet. Pick who's talking to a customer at the top of their page.`
                  : "Customers are added when someone fills in the quote form, you log a conversation in the price log, or you add them yourself."
          }
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
                          {[
                            c.phone ? formatPhone(c.phone) : null,
                            last ? `Last job ${day(last.when)} · ${titleCase(last.status)}` : "No jobs yet",
                            c.communicator_id ? `Talking to: ${nameOf.get(c.communicator_id) ?? "Someone"}` : null,
                          ]
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
                <TableHead>Talking to</TableHead>
                <TableHead className="hidden sm:table-cell">Opt-ins</TableHead>
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
                    <TableCell className="whitespace-nowrap">
                      {c.communicator_id ? (
                        nameOf.get(c.communicator_id) ?? "Someone"
                      ) : (
                        <span className="text-xs text-ink-muted">Nobody yet</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
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

  const [leads, quotes, jobs, messages, services, interactions, team] = await Promise.all([
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
    loadTeam(db),
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
    team: pickable(team, customer.data.communicator_id),
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
  const meId = (await getSession())?.profile.id ?? null

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
            actions={
              <>
                <CommunicatorPicker customerId={data.customer.id} initial={data.customer.communicator_id} team={data.team} meId={meId} />
                {panel ? <RebookButton customerId={data.customer.id} leadHref="/admin?stage=leads&id=" /> : null}
              </>
            }
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
              <CardTitle className="text-base">Schedule a job</CardTitle>
            </CardHeader>
            <CardContent>
              <ScheduleJobForm today={today} customer={{ id: data.customer.id, name: data.customer.name }} />
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
                    <TableCell>{l.door_rep ? `${l.source} · ${l.door_rep}` : l.source}</TableCell>
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
