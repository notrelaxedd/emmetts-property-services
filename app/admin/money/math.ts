/**
 * Pure money math for the owner console (Money + Employees pages). No I/O.
 * All amounts are dollars; results are rounded to cents.
 */
import { addDays, localDate, weekStart } from "@/lib/scheduler/time"

export const EXPENSE_CATEGORIES = ["fuel", "equipment", "supplies", "ads", "other"] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
/** "$1,234.50"; negative as "-$12.00". */
export function usd(n: number): string {
  return usdFmt.format(Number.isFinite(n) ? n : 0)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function sum<T>(rows: readonly T[], pick: (r: T) => number | null | undefined): number {
  return round2(rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0))
}

/** "YYYY-MM" from a query param, defaulting to the current business-timezone month. */
export function parseMonth(param: string | undefined | null, now: Date = new Date()): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param
  return localDate(now).slice(0, 7)
}

/** Calendar month as local dates: first day and first day of the next month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  return { from: `${month}-01`, to: `${next}-01` }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`
}

/** "October 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

// ---------- Inputs ----------

export type MoneyQuote = {
  id: string
  price_total: number
  fee_total: number
  labor_total: number
  accepted_at: string | null
}
export type MoneyJob = {
  id: string
  quote_id: string | null
  customer_name: string
  status: string
  start_at: string | null
  completed_at: string | null
}
export type MoneyPayout = { job_id: string; amount: number }
export type MoneyExpense = { date: string; amount: number }

export type JobLabor = { amount: number; estimated: boolean }

/** Labor for a job: real payouts when any exist, else the quote's estimated labor. */
export function laborForJob(
  job: Pick<MoneyJob, "id" | "quote_id">,
  payouts: readonly MoneyPayout[],
  quotesById: ReadonlyMap<string, Pick<MoneyQuote, "labor_total">>,
): JobLabor {
  const mine = payouts.filter((p) => p.job_id === job.id)
  if (mine.length) return { amount: sum(mine, (p) => p.amount), estimated: false }
  const q = job.quote_id ? quotesById.get(job.quote_id) : undefined
  return { amount: round2(Number(q?.labor_total ?? 0)), estimated: true }
}

export type MonthSummary = {
  revenue: number
  fees: number
  labor: number
  laborEstimated: boolean
  expenses: number
  aiSpend: number
  profit: number
}

/**
 * The month's headline numbers.
 * - revenue / fees: quotes accepted (paid via Stripe, or by cash / check with no fee) in the month
 * - labor: jobs completed in the month (payouts, or estimated labor when no payouts yet)
 * - profit = revenue − fees − labor − expenses − AI spend
 */
export function summarizeMonth(input: {
  acceptedQuotes: readonly MoneyQuote[]
  completedJobs: readonly MoneyJob[]
  payouts: readonly MoneyPayout[]
  quotesById: ReadonlyMap<string, Pick<MoneyQuote, "labor_total">>
  expenses: readonly MoneyExpense[]
  aiSpend: number
}): MonthSummary {
  const revenue = sum(input.acceptedQuotes, (q) => q.price_total)
  const fees = sum(input.acceptedQuotes, (q) => q.fee_total)
  const labors = input.completedJobs.map((j) => laborForJob(j, input.payouts, input.quotesById))
  const labor = sum(labors, (l) => l.amount)
  const expenses = sum(input.expenses, (e) => e.amount)
  const aiSpend = round2(input.aiSpend || 0)
  return {
    revenue,
    fees,
    labor,
    laborEstimated: labors.some((l) => l.estimated && l.amount > 0),
    expenses,
    aiSpend,
    profit: round2(revenue - fees - labor - expenses - aiSpend),
  }
}

export type JobProfitRow = {
  job_id: string
  customer_name: string
  status: string
  date: string | null
  price: number
  fee: number
  labor: number
  laborEstimated: boolean
  profit: number
}

/** Per-job profit: price − card fee − labor (payouts, or estimate). Newest first. */
export function profitPerJob(
  jobs: readonly MoneyJob[],
  quotesById: ReadonlyMap<string, MoneyQuote>,
  payouts: readonly MoneyPayout[],
): JobProfitRow[] {
  return jobs
    .map((j) => {
      const q = j.quote_id ? quotesById.get(j.quote_id) : undefined
      const price = round2(Number(q?.price_total ?? 0))
      const fee = round2(Number(q?.fee_total ?? 0))
      const l = laborForJob(j, payouts, quotesById)
      const when = j.completed_at ?? j.start_at ?? q?.accepted_at ?? null
      return {
        job_id: j.id,
        customer_name: j.customer_name,
        status: j.status,
        date: when ? localDate(new Date(when)) : null,
        price,
        fee,
        labor: l.amount,
        laborEstimated: l.estimated,
        profit: round2(price - fee - l.amount),
      }
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
}

export type WeekRow = { week: string; revenue: number; fees: number; labor: number; expenses: number; profit: number }

/**
 * Mon–Sun weeks that touch the month. Revenue/fees by quote `accepted_at`, labor by job
 * `completed_at`, expenses by `date`. AI spend is month-level only and not split by week.
 */
export function profitPerWeek(input: {
  month: string
  acceptedQuotes: readonly MoneyQuote[]
  completedJobs: readonly MoneyJob[]
  payouts: readonly MoneyPayout[]
  quotesById: ReadonlyMap<string, Pick<MoneyQuote, "labor_total">>
  expenses: readonly MoneyExpense[]
}): WeekRow[] {
  const { from, to } = monthRange(input.month)
  const weeks = new Map<string, WeekRow>()
  for (let w = weekStart(from); w < to; w = addDays(w, 7)) {
    weeks.set(w, { week: w, revenue: 0, fees: 0, labor: 0, expenses: 0, profit: 0 })
  }
  const bucket = (date: string) => weeks.get(weekStart(date))
  for (const q of input.acceptedQuotes) {
    if (!q.accepted_at) continue
    const row = bucket(localDate(new Date(q.accepted_at)))
    if (!row) continue
    row.revenue += Number(q.price_total) || 0
    row.fees += Number(q.fee_total) || 0
  }
  for (const j of input.completedJobs) {
    if (!j.completed_at) continue
    const row = bucket(localDate(new Date(j.completed_at)))
    if (row) row.labor += laborForJob(j, input.payouts, input.quotesById).amount
  }
  for (const e of input.expenses) {
    const row = bucket(e.date.slice(0, 10))
    if (row) row.expenses += Number(e.amount) || 0
  }
  return Array.from(weeks.values()).map((r) => ({
    week: r.week,
    revenue: round2(r.revenue),
    fees: round2(r.fees),
    labor: round2(r.labor),
    expenses: round2(r.expenses),
    profit: round2(r.revenue - r.fees - r.labor - r.expenses),
  }))
}
