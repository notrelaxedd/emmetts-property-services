/**
 * Pure money math for the calendar: what each job brings in, what it costs in crew pay, and what you
 * take home. No I/O, so the board, the job panel and tests can all use it.
 *
 *   labor     = paid payouts (done jobs) | Σ crew hourly rate × job hours (crew on it) | quote estimate
 *   card fee  = only when the customer pays (or paid) by card
 *   take-home = price − card fee − labor
 */
import type { JobStatus, PaymentMethod } from "@/lib/db/types"

/** Where the labor number comes from, shown next to it so you know how firm it is. */
export type LaborBasis = "paid" | "crew" | "owner" | "estimate" | "set"

export type JobMoney = {
  price: number
  /** Card fee: 0 unless the customer pays by card. */
  fee: number
  labor: number
  profit: number
  basis: LaborBasis
}

export const BASIS_LABEL: Record<LaborBasis, string> = {
  paid: "crew pay recorded",
  crew: "crew rates × hours",
  owner: "owners doing it, no crew pay",
  estimate: "estimate",
  set: "take-home set by you",
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Crew who are (or said they'll be) on the job. */
export function isGoing(status: string): boolean {
  return status === "accepted" || status === "drop_requested"
}

const BOOKED: readonly JobStatus[] = ["booked", "in_progress", "done"]

export function cardFee(quote: { feeTotal: number; paymentMethod: PaymentMethod | null; paidAt: string | null } | null): number {
  if (!quote) return 0
  return quote.paymentMethod === "stripe" ? r2(quote.feeTotal) : 0
}

export function jobMoney(input: {
  status: JobStatus
  /** On-site hours (wall clock). */
  hours: number
  crewSize: number
  crew: { status: string; rate: number }[]
  /** The owners do it themselves: no crew pay unless some was recorded. */
  ownersWorking?: boolean
  quote: { priceTotal: number; feeTotal: number; laborTotal: number; paymentMethod: PaymentMethod | null; paidAt: string | null } | null
  /** Sum of payouts written for the job, or null when none. */
  payouts: number | null
  profitOverride: number | null
  defaultWage: number
}): JobMoney {
  const price = r2(input.quote?.priceTotal ?? 0)
  const fee = cardFee(input.quote)
  const done = (labor: number, basis: LaborBasis): JobMoney => ({ price, fee, labor: r2(labor), profit: r2(price - fee - labor), basis })

  if (input.profitOverride !== null) return { price, fee, labor: r2(price - fee - input.profitOverride), profit: r2(input.profitOverride), basis: "set" }
  if (input.ownersWorking) return done(input.payouts ?? 0, "owner")
  if (input.payouts !== null) return done(input.payouts, "paid")
  const going = input.crew.filter((c) => isGoing(c.status))
  if (BOOKED.includes(input.status)) {
    if (!going.length) return done(0, "owner")
    return done(going.reduce((s, c) => s + c.rate * input.hours, 0), "crew")
  }
  // Not booked yet: the crew who said yes cover the estimate's crew size → their real rates.
  if (going.length && going.length >= input.crewSize) {
    return done(going.slice(0, input.crewSize).reduce((s, c) => s + c.rate * input.hours, 0), "crew")
  }
  if (input.quote && input.quote.laborTotal > 0) return done(input.quote.laborTotal, "estimate")
  return done(Math.max(1, input.crewSize) * input.hours * input.defaultWage, "estimate")
}

export type DayTotals = {
  jobs: number
  price: number
  labor: number
  profit: number
  /** Job hours on site (wall clock). */
  hours: number
  /** Hours per crew member that day, biggest first. */
  crew: { id: string; name: string; hours: number }[]
}

/** Totals for a set of jobs (a day or a week). Cancelled jobs don't count. */
export function totals(
  jobs: readonly { status: JobStatus; hours: number; money: JobMoney; crew: { id: string; name: string; status: string }[] }[],
): DayTotals {
  const t: DayTotals = { jobs: 0, price: 0, labor: 0, profit: 0, hours: 0, crew: [] }
  const crew = new Map<string, { id: string; name: string; hours: number }>()
  for (const j of jobs) {
    if (j.status === "cancelled") continue
    t.jobs++
    t.price += j.money.price
    t.labor += j.money.labor
    t.profit += j.money.profit
    t.hours += j.hours
    for (const c of j.crew) {
      if (!isGoing(c.status)) continue
      const row = crew.get(c.id) ?? { id: c.id, name: c.name, hours: 0 }
      row.hours += j.hours
      crew.set(c.id, row)
    }
  }
  return {
    ...t,
    price: r2(t.price),
    labor: r2(t.labor),
    profit: r2(t.profit),
    hours: r2(t.hours),
    crew: Array.from(crew.values())
      .map((c) => ({ ...c, hours: r2(c.hours) }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
  }
}

/** "$1,240" / "$37.50" */
export function usd(n: number): string {
  const neg = n < 0
  const a = Math.abs(n)
  const s = Number.isInteger(r2(a)) ? Math.round(a).toLocaleString("en-US") : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${neg ? "-" : ""}$${s}`
}

/** "2.5h", "45m" */
export function hrs(h: number): string {
  if (h <= 0) return "0h"
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${Math.round(h * 4) / 4}h`
}
