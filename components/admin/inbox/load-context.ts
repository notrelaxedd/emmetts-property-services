import "server-only"

import type { Approval, ApprovalKind, Customer, Job, QuoteItem } from "@/lib/db/types"
import { getSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import type { Db } from "@/lib/ops/types"
import { localDate, zonedToUtc } from "@/lib/scheduler/time"
import type {
  CustomerSummary,
  InboxContext,
  InboxEntry,
  JobSummary,
  Photo,
} from "./types"

export const LEAD_PHOTO_BUCKET = "lead-photos"
const SIGNED_URL_TTL = 3600
const HOUR_MS = 3_600_000

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

/** `payload[key]` if it is a string, else `ref_id` when the approval points at `table`. */
function refOf(approval: Approval, key: string, table: string): string | null {
  return str(approval.payload[key]) ?? (approval.ref_table === table ? approval.ref_id : null)
}

export function customerSummary(c: Customer | null | undefined): CustomerSummary | null {
  if (!c) return null
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    lot_acres: c.lot_acres,
    tree_cover: c.tree_cover,
    email_opt_in: c.email_opt_in,
    sms_opt_in: c.sms_opt_in,
  }
}

/** Signed (1 h) URLs for private `lead-photos` objects. A failed signature yields `url: null`. */
export async function signLeadPhotos(db: Db, paths: string[]): Promise<Photo[]> {
  if (!paths.length) return []
  const { data, error } = await db.storage.from(LEAD_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
  if (error || !data) return paths.map((path) => ({ path, url: null }))
  return paths.map((path) => {
    const hit = data.find((d) => d.path === path)
    return { path, url: hit?.signedUrl ?? null }
  })
}

async function customerById(db: Db, id: string | null | undefined): Promise<Customer | null> {
  if (!id) return null
  return check(await db.from("customers").select("*").eq("id", id).maybeSingle(), "inbox(customer)")
}

/** Jobs + their customers, in start order (unscheduled last). */
export async function jobSummaries(db: Db, ids: string[]): Promise<JobSummary[]> {
  if (!ids.length) return []
  const jobs = check(await db.from("jobs").select("*").in("id", ids), "inbox(jobs)") ?? []
  return summarizeJobs(db, jobs)
}

async function summarizeJobs(db: Db, jobs: Job[]): Promise<JobSummary[]> {
  const customerIds = Array.from(new Set(jobs.map((j) => j.customer_id)))
  const customers = customerIds.length
    ? (check(await db.from("customers").select("id,name,address").in("id", customerIds), "inbox(job customers)") ?? [])
    : []
  const byId = new Map(customers.map((c) => [c.id, c]))
  return jobs
    .map((j) => ({
      id: j.id,
      status: j.status,
      start_at: j.start_at,
      end_at: j.end_at,
      est_minutes: j.est_minutes,
      customer_name: byId.get(j.customer_id)?.name ?? null,
      address: byId.get(j.customer_id)?.address ?? null,
    }))
    .sort((a, b) => (a.start_at ?? "9999").localeCompare(b.start_at ?? "9999"))
}

async function profileNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = check(await db.from("profiles").select("id,name").in("id", ids), "inbox(profiles)") ?? []
  return new Map(rows.map((p) => [p.id, p.name]))
}

const bySort = (a: QuoteItem, b: QuoteItem) => a.sort_order - b.sort_order

// ---------- Per-kind loaders ----------

async function quoteContext(db: Db, approval: Approval): Promise<InboxContext> {
  const quoteId = refOf(approval, "quote_id", "quotes")
  if (!quoteId) return { kind: "quote", quote: null, customer: null, items: [], error: "No quote_id on this approval." }
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "inbox(quote)")
  if (!quote) return { kind: "quote", quote: null, customer: null, items: [], error: "The quote no longer exists." }
  const [items, customer] = await Promise.all([
    db.from("quote_items").select("*").eq("quote_id", quoteId),
    customerById(db, quote.customer_id),
  ])
  return {
    kind: "quote",
    quote,
    customer: customerSummary(customer),
    items: (check(items, "inbox(quote items)") ?? []).sort(bySort),
  }
}

async function customItemContext(db: Db, approval: Approval): Promise<InboxContext> {
  const empty = {
    kind: "custom_item" as const,
    item: null,
    quote: null,
    customer: null,
    customRequest: null,
    photos: [],
    standardItems: [],
    standardTotal: 0,
  }
  const itemId = refOf(approval, "quote_item_id", "quote_items")
  const item = itemId
    ? check(await db.from("quote_items").select("*").eq("id", itemId).maybeSingle(), "inbox(custom item)")
    : null
  const quoteId = str(approval.payload.quote_id) ?? item?.quote_id ?? null
  if (!quoteId) return { ...empty, item, error: "No quote for this custom request." }
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "inbox(custom quote)")
  if (!quote) return { ...empty, item, error: "The quote no longer exists." }
  const [itemsRes, customer, lead] = await Promise.all([
    db.from("quote_items").select("*").eq("quote_id", quoteId),
    customerById(db, quote.customer_id),
    db.from("leads").select("*").eq("id", quote.lead_id).maybeSingle(),
  ])
  const items = (check(itemsRes, "inbox(custom quote items)") ?? []).sort(bySort)
  const leadRow = check(lead, "inbox(custom lead)")
  const standardItems = items.filter((i) => !i.is_custom && i.id !== item?.id)
  const standardTotal = standardItems
    .filter((i) => i.status === "auto" || i.status === "priced")
    .reduce((s, i) => s + (i.price ?? 0), 0)
  return {
    kind: "custom_item",
    item,
    quote,
    customer: customerSummary(customer),
    customRequest: leadRow?.custom_request ?? null,
    photos: await signLeadPhotos(db, leadRow?.photo_paths ?? []),
    standardItems,
    standardTotal,
    ...(item ? {} : { error: "The custom line item no longer exists." }),
  }
}

async function adContext(db: Db, approval: Approval): Promise<InboxContext> {
  const adId = refOf(approval, "ad_id", "ads")
  const ad = adId ? check(await db.from("ads").select("*").eq("id", adId).maybeSingle(), "inbox(ad)") : null
  return { kind: "ad", ad, ...(ad ? {} : { error: "The ad row is missing; showing the drafted copy only." }) }
}

async function bookingContext(db: Db, approval: Approval): Promise<InboxContext> {
  const jobId = refOf(approval, "job_id", "jobs")
  const empty = { kind: "booking" as const, job: null, scheduleReason: null, customer: null, crew: [], services: [] }
  if (!jobId) return { ...empty, error: "No job_id on this approval." }
  const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "inbox(booking job)")
  if (!job) return { ...empty, error: "The job no longer exists." }
  const [customer, assignmentsRes, itemsRes] = await Promise.all([
    customerById(db, job.customer_id),
    db.from("job_assignments").select("*").eq("job_id", jobId),
    job.quote_id
      ? db.from("quote_items").select("*").eq("quote_id", job.quote_id).in("status", ["auto", "priced"])
      : Promise.resolve({ data: [] as QuoteItem[], error: null }),
  ])
  const assignments = (check(assignmentsRes, "inbox(booking crew)") ?? []).filter(
    (a) => a.status !== "declined" && a.status !== "dropped",
  )
  // Swap rows: crew_id = person being offered, swap_to_crew_id = person handing over.
  const names = await profileNames(db, [
    ...assignments.map((a) => a.crew_id),
    ...assignments.map((a) => a.swap_to_crew_id).filter((x): x is string => !!x),
  ])
  const [summary] = await summarizeJobs(db, [job])
  return {
    kind: "booking",
    job: summary ?? null,
    scheduleReason: job.schedule_reason,
    customer: customerSummary(customer),
    crew: assignments.map((a) => ({
      name: names.get(a.crew_id) ?? "Unknown crew",
      status: a.status,
      swapFrom: a.status === "swap_offered" && a.swap_to_crew_id ? (names.get(a.swap_to_crew_id) ?? "another crew member") : null,
    })),
    services: (check(itemsRes, "inbox(booking items)") ?? []).sort(bySort).map((i) => i.description),
  }
}

async function followupContext(db: Db, approval: Approval): Promise<InboxContext> {
  const ids = Array.from(
    new Set([
      ...strList(approval.payload.message_ids),
      ...(str(approval.payload.message_id) ? [str(approval.payload.message_id) as string] : []),
      ...(approval.ref_table === "messages" ? [approval.ref_id] : []),
    ]),
  )
  if (!ids.length) return { kind: "followup", messages: [], recipients: [], error: "No message ids on this approval." }
  const messages =
    check(
      await db.from("messages").select("id,customer_id,kind,channel,subject,body,status").in("id", ids),
      "inbox(followup messages)",
    ) ?? []
  const customerIds = Array.from(new Set(messages.map((m) => m.customer_id)))
  const customers = customerIds.length
    ? (check(await db.from("customers").select("id,name,email").in("id", customerIds), "inbox(followup customers)") ?? [])
    : []
  return {
    kind: "followup",
    messages,
    recipients: customers.map((c) => ({ name: c.name, email: c.email })),
  }
}

async function crewChangeContext(db: Db, approval: Approval): Promise<InboxContext> {
  const excId = refOf(approval, "crew_exception_id", "crew_exceptions")
  const empty = { kind: "crew_change" as const, exception: null, crewName: null, jobsHit: [] }
  if (!excId) return { ...empty, error: "No crew_exception_id on this approval." }
  const exception = check(await db.from("crew_exceptions").select("*").eq("id", excId).maybeSingle(), "inbox(crew exception)")
  if (!exception) return { ...empty, error: "The time-off request no longer exists." }
  const names = await profileNames(db, [exception.crew_id])

  let jobsHit: JobSummary[]
  const payloadJobs = strList(approval.payload.job_ids)
  if (payloadJobs.length) {
    jobsHit = await jobSummaries(db, payloadJobs)
  } else {
    // Jobs this crew member is on that fall inside the requested dates (and hours, for a partial day).
    const assignments =
      check(
        await db
          .from("job_assignments")
          .select("job_id,status")
          .eq("crew_id", exception.crew_id)
          .in("status", ["offered", "accepted", "swap_offered", "drop_requested"]),
        "inbox(crew assignments)",
      ) ?? []
    const from = zonedToUtc(exception.date_from, "00:00").toISOString()
    const to = zonedToUtc(exception.date_to, "24:00").toISOString()
    const jobs = assignments.length
      ? (check(
          await db
            .from("jobs")
            .select("*")
            .in("id", assignments.map((a) => a.job_id))
            .not("status", "in", "(done,cancelled)")
            .lt("start_at", to)
            .gte("end_at", from),
          "inbox(crew jobs)",
        ) ?? [])
      : []
    const partial = exception.start_time && exception.end_time
    const hits = jobs.filter((j) => {
      if (!partial || !j.start_at || !j.end_at) return true
      const day = localDate(new Date(j.start_at))
      const winStart = zonedToUtc(day, exception.start_time as string).getTime()
      const winEnd = zonedToUtc(day, exception.end_time as string).getTime()
      return Date.parse(j.start_at) < winEnd && Date.parse(j.end_at) > winStart
    })
    jobsHit = await summarizeJobs(db, hits)
  }
  return { kind: "crew_change", exception, crewName: names.get(exception.crew_id) ?? null, jobsHit }
}

async function dropContext(db: Db, approval: Approval): Promise<InboxContext> {
  const assignmentId = refOf(approval, "assignment_id", "job_assignments")
  const empty = { kind: "drop" as const, crewName: null, assignmentStatus: null, job: null, hoursUntilStart: null }
  const assignment = assignmentId
    ? check(await db.from("job_assignments").select("*").eq("id", assignmentId).maybeSingle(), "inbox(drop assignment)")
    : null
  const jobId = str(approval.payload.job_id) ?? assignment?.job_id ?? null
  if (!jobId) return { ...empty, error: "No job for this drop request." }
  const [jobs, names] = await Promise.all([
    jobSummaries(db, [jobId]),
    profileNames(db, assignment ? [assignment.crew_id] : []),
  ])
  const job = jobs[0] ?? null
  return {
    kind: "drop",
    crewName: assignment ? (names.get(assignment.crew_id) ?? null) : null,
    assignmentStatus: assignment?.status ?? null,
    job,
    hoursUntilStart: job?.start_at ? Math.round(((Date.parse(job.start_at) - Date.now()) / HOUR_MS) * 10) / 10 : null,
    ...(assignment ? {} : { error: "The crew assignment no longer exists." }),
  }
}

async function weatherHoldContext(db: Db, approval: Approval): Promise<InboxContext> {
  const ids = strList(approval.payload.job_ids)
  const jobIds = ids.length ? ids : approval.ref_table === "jobs" ? [approval.ref_id] : []
  return { kind: "weather_hold", jobs: await jobSummaries(db, jobIds) }
}

async function aiCapContext(db: Db): Promise<InboxContext> {
  const [spend, settings] = await Promise.all([db.rpc("ai_spend_this_month"), getSettings(db)])
  return { kind: "ai_cap", spend: Number(check(spend, "inbox(ai spend)") ?? 0) || 0, cap: settings.ai_monthly_cap }
}

function emptyContext(kind: ApprovalKind, error: string): InboxContext {
  switch (kind) {
    case "quote":
      return { kind, quote: null, customer: null, items: [], error }
    case "custom_item":
      return { kind, item: null, quote: null, customer: null, customRequest: null, photos: [], standardItems: [], standardTotal: 0, error }
    case "ad":
      return { kind, ad: null, error }
    case "booking":
      return { kind, job: null, scheduleReason: null, customer: null, crew: [], services: [], error }
    case "followup":
      return { kind, messages: [], recipients: [], error }
    case "crew_change":
      return { kind, exception: null, crewName: null, jobsHit: [], error }
    case "drop":
      return { kind, crewName: null, assignmentStatus: null, job: null, hoursUntilStart: null, error }
    case "weather_hold":
      return { kind, jobs: [], error }
    case "ai_cap":
      return { kind, spend: 0, cap: null, error }
  }
}

/** Server-fetched data each inbox card needs. Never throws: a failure becomes `context.error`. */
export async function loadContext(db: Db, approval: Approval): Promise<InboxContext> {
  try {
    switch (approval.kind) {
      case "quote":
        return await quoteContext(db, approval)
      case "custom_item":
        return await customItemContext(db, approval)
      case "ad":
        return await adContext(db, approval)
      case "booking":
        return await bookingContext(db, approval)
      case "followup":
        return await followupContext(db, approval)
      case "crew_change":
        return await crewChangeContext(db, approval)
      case "drop":
        return await dropContext(db, approval)
      case "weather_hold":
        return await weatherHoldContext(db, approval)
      case "ai_cap":
        return await aiCapContext(db)
    }
  } catch (e) {
    return emptyContext(approval.kind, e instanceof Error ? e.message : String(e))
  }
}

export async function loadEntries(db: Db, approvals: Approval[]): Promise<InboxEntry[]> {
  return Promise.all(approvals.map(async (approval) => ({ approval, context: await loadContext(db, approval) })))
}
