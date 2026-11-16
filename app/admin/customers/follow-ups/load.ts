import "server-only"

import { planFollowUp, sortFollowUps, type FollowUp, type FollowUpInput } from "@/lib/followups/plan"
import type { Purchase } from "@/lib/followups/sell"
import type { Db } from "@/lib/ops/types"
import { localDate } from "@/lib/scheduler/time"
import { siteConfig } from "@/lib/site-config"

export type FollowUpRow = FollowUp & { name: string; phone: string | null; email: string | null }

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Reads every row of a query, 1000 at a time (the API caps a single read). THROWS on a query error. */
async function all<T>(what: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const res = await page(from, from + 999)
    if (res.error) throw new Error(`${what}: ${res.error.message}`)
    rows.push(...(res.data ?? []))
    if ((res.data ?? []).length < 1000) break
  }
  return rows
}

const day = (iso: string | null | undefined) => (iso ? localDate(new Date(iso)) : null)
function group<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
  return m
}

/** Every customer's next follow-up, most urgent first. Customers with a job on the calendar are left out. */
export async function loadFollowUps(db: Db, today: string): Promise<FollowUpRow[]> {
  type C = { id: string; name: string; phone: string | null; email: string | null; created_at: string }
  type J = { customer_id: string; quote_id: string | null; status: string; start_at: string | null; end_at: string | null; completed_at: string | null }
  type Q = { id: string; customer_id: string; lead_id: string | null; status: string; sent_at: string | null; created_at: string; price_total: number }
  type L = { id: string; customer_id: string; status: string; created_at: string }
  type I = { quote_id: string; service_id: string | null; description: string; status: string; sort_order: number }
  type T = { customer_id: string; talked_on: string; created_at: string; category: string; price: number | null; follow_up_on: string | null; status: string }
  type Plan = { id: string; customer_id: string; active: boolean }

  const [customers, jobs, quotes, leads, items, talks, services, mows, cuts, snows, pushes] = await Promise.all([
    all<C>("follow-ups(customers)", (a, b) => db.from("customers").select("id,name,phone,email,created_at").order("created_at").range(a, b)),
    all<J>("follow-ups(jobs)", (a, b) => db.from("jobs").select("customer_id,quote_id,status,start_at,end_at,completed_at").neq("status", "cancelled").order("created_at").range(a, b)),
    all<Q>("follow-ups(quotes)", (a, b) => db.from("quotes").select("id,customer_id,lead_id,status,sent_at,created_at,price_total").order("created_at").range(a, b)),
    all<L>("follow-ups(leads)", (a, b) => db.from("leads").select("id,customer_id,status,created_at").order("created_at").range(a, b)),
    all<I>("follow-ups(items)", (a, b) => db.from("quote_items").select("quote_id,service_id,description,status,sort_order").order("created_at").range(a, b)),
    all<T>("follow-ups(price log)", (a, b) =>
      db.from("customer_interactions").select("customer_id,talked_on,created_at,category,price,follow_up_on,status").order("created_at").range(a, b),
    ),
    all<{ id: string; slug: string; name: string; active: boolean }>("follow-ups(services)", (a, b) => db.from("services").select("id,slug,name,active").range(a, b)),
    all<Plan>("follow-ups(mowing)", (a, b) => db.from("mow_customers").select("id,customer_id,active").range(a, b)),
    all<{ mow_customer_id: string; cut_at: string }>("follow-ups(cuts)", (a, b) => db.from("mow_cuts").select("mow_customer_id,cut_at").order("cut_at", { ascending: false }).range(a, b)),
    all<Plan>("follow-ups(snow)", (a, b) => db.from("snow_customers").select("id,customer_id,active").range(a, b)),
    all<{ snow_customer_id: string; pushed_at: string }>("follow-ups(pushes)", (a, b) =>
      db.from("snow_pushes").select("snow_customer_id,pushed_at").order("pushed_at", { ascending: false }).range(a, b),
    ),
  ])

  const slugOf = new Map(services.map((s) => [s.id, s.slug]))
  const catalogue = new Map(services.filter((s) => s.active).map((s) => [s.slug, s.name]))
  const billed = items.filter((i) => i.status === "auto" || i.status === "priced").sort((a, b) => a.sort_order - b.sort_order)
  const itemsByQuote = group(billed, (i) => i.quote_id)
  const jobsBy = group(jobs, (j) => j.customer_id)
  const quotesBy = group(quotes, (q) => q.customer_id)
  const leadsBy = group(leads, (l) => l.customer_id)
  const talksBy = group(talks, (t) => t.customer_id)
  const quoteWithJob = new Set(jobs.map((j) => j.quote_id).filter(Boolean))
  const leadWithQuote = new Set(quotes.map((q) => q.lead_id).filter(Boolean))
  // Newest first, so the first one seen per plan is the latest.
  const lastCut = new Map<string, string>()
  for (const c of cuts) if (!lastCut.has(c.mow_customer_id)) lastCut.set(c.mow_customer_id, c.cut_at)
  const lastPush = new Map<string, string>()
  for (const p of pushes) if (!lastPush.has(p.snow_customer_id)) lastPush.set(p.snow_customer_id, p.pushed_at)
  const mowBy = new Map(mows.map((m) => [m.customer_id, m]))
  const snowBy = new Map(snows.map((s) => [s.customer_id, s]))

  const rows: FollowUpRow[] = []
  for (const c of customers) {
    const mine = jobsBy.get(c.id) ?? []
    const mow = mowBy.get(c.id)
    const snow = snowBy.get(c.id)
    const lastCutOn = mow ? day(lastCut.get(mow.id)) : null
    const lastPushOn = snow ? day(lastPush.get(snow.id)) : null
    const purchases: Purchase[] = []
    const jobRows: FollowUpInput["jobs"] = mine.map((j) => {
      const on = j.status === "done" ? day(j.completed_at ?? j.end_at ?? j.start_at) : day(j.start_at)
      const its = j.quote_id ? (itemsByQuote.get(j.quote_id) ?? []) : []
      if (j.status === "done" && on) for (const i of its) if (i.service_id && slugOf.has(i.service_id)) purchases.push({ slug: slugOf.get(i.service_id) as string, on })
      return { status: j.status, on, services: its.map((i) => i.description) }
    })
    if (lastCutOn) purchases.push({ slug: "lawn-mowing", on: lastCutOn })
    if (lastPushOn) purchases.push({ slug: "snow-removal", on: lastPushOn })

    const plan = planFollowUp({
      today,
      businessName: siteConfig.name,
      customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, createdOn: day(c.created_at) as string },
      onMowing: !!mow?.active,
      onSnow: !!snow?.active,
      jobs: jobRows,
      lastCutOn,
      lastPushOn,
      quotes: (quotesBy.get(c.id) ?? []).map((q) => ({
        id: q.id,
        status: q.status,
        sentOn: day(q.sent_at),
        createdOn: day(q.created_at) as string,
        total: Number(q.price_total),
        services: (itemsByQuote.get(q.id) ?? []).map((i) => i.description),
        hasJob: quoteWithJob.has(q.id),
      })),
      leads: (leadsBy.get(c.id) ?? []).map((l) => ({ id: l.id, status: l.status, createdOn: day(l.created_at) as string, hasQuote: leadWithQuote.has(l.id) })),
      interactions: (talksBy.get(c.id) ?? []).map((t) => ({
        talkedOn: t.talked_on,
        createdAt: t.created_at,
        category: t.category,
        price: t.price === null ? null : Number(t.price),
        followUpOn: t.follow_up_on,
        status: t.status,
      })),
      purchases,
      catalogue,
    })
    if (plan) rows.push({ ...plan, name: c.name, phone: c.phone, email: c.email })
  }
  return sortFollowUps(rows)
}
