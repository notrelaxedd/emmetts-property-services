import { describe, expect, it } from "vitest"
import {
  laborForJob,
  monthRange,
  parseMonth,
  profitPerJob,
  profitPerWeek,
  shiftMonth,
  summarizeMonth,
  type MoneyJob,
  type MoneyQuote,
} from "./math"

const q1: MoneyQuote = { id: "q1", price_total: 90, fee_total: 2.91, labor_total: 45, accepted_at: "2026-10-05T14:00:00Z" }
const q2: MoneyQuote = { id: "q2", price_total: 200, fee_total: 6.1, labor_total: 80, accepted_at: "2026-10-20T14:00:00Z" }
const quotes = new Map([q1, q2].map((q) => [q.id, q]))
const j1: MoneyJob = { id: "j1", quote_id: "q1", customer_name: "Ann", status: "done", start_at: "2026-10-07T13:00:00Z", completed_at: "2026-10-07T15:00:00Z" }
const j2: MoneyJob = { id: "j2", quote_id: "q2", customer_name: "Bob", status: "done", start_at: "2026-10-21T13:00:00Z", completed_at: "2026-10-21T16:00:00Z" }

describe("month helpers", () => {
  it("parses and shifts months", () => {
    expect(parseMonth("2026-10")).toBe("2026-10")
    expect(parseMonth("2026-13", new Date("2026-03-15T12:00:00Z"))).toBe("2026-03")
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" })
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
  })
})

describe("labor", () => {
  it("uses payouts when present, else the quote estimate", () => {
    expect(laborForJob(j1, [{ job_id: "j1", amount: 22.5 }, { job_id: "j1", amount: 22.5 }], quotes)).toEqual({ amount: 45, estimated: false })
    expect(laborForJob(j2, [], quotes)).toEqual({ amount: 80, estimated: true })
    expect(laborForJob({ id: "x", quote_id: null }, [], quotes)).toEqual({ amount: 0, estimated: true })
  })
})

describe("summarizeMonth", () => {
  it("computes profit = revenue − fees − labor − expenses − AI", () => {
    const s = summarizeMonth({
      acceptedQuotes: [q1, q2],
      completedJobs: [j1, j2],
      payouts: [{ job_id: "j1", amount: 50 }],
      quotesById: quotes,
      expenses: [{ date: "2026-10-03", amount: 40 }],
      aiSpend: 1.25,
    })
    expect(s).toEqual({
      revenue: 290,
      fees: 9.01,
      labor: 130,
      laborEstimated: true,
      expenses: 40,
      aiSpend: 1.25,
      profit: 109.74,
    })
  })

  it("is all zeros with no rows", () => {
    const s = summarizeMonth({ acceptedQuotes: [], completedJobs: [], payouts: [], quotesById: new Map(), expenses: [], aiSpend: 0 })
    expect(s.profit).toBe(0)
    expect(s.laborEstimated).toBe(false)
  })
})

describe("per job / per week", () => {
  it("profit per job", () => {
    const rows = profitPerJob([j1, j2], quotes, [{ job_id: "j1", amount: 45 }])
    expect(rows.map((r) => [r.job_id, r.profit, r.laborEstimated])).toEqual([
      ["j2", 113.9, true],
      ["j1", 42.09, false],
    ])
  })

  it("buckets into Mon–Sun weeks touching the month", () => {
    const weeks = profitPerWeek({
      month: "2026-10",
      acceptedQuotes: [q1, q2],
      completedJobs: [j1, j2],
      payouts: [],
      quotesById: quotes,
      expenses: [{ date: "2026-10-01", amount: 10 }],
    })
    expect(weeks.map((w) => w.week)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"])
    expect(weeks[0]).toMatchObject({ expenses: 10, profit: -10 })
    expect(weeks[1]).toMatchObject({ revenue: 90, fees: 2.91, labor: 45, profit: 42.09 })
    expect(weeks[3]).toMatchObject({ revenue: 200, labor: 80, profit: 113.9 })
  })
})
