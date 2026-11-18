import { describe, expect, it } from "vitest"
import { cardFee, hrs, jobMoney, totals, usd } from "./money"

const quote = (over: Partial<Parameters<typeof jobMoney>[0]["quote"] & object> = {}) => ({
  priceTotal: 200,
  feeTotal: 6.1,
  laborTotal: 60,
  paymentMethod: null,
  paidAt: null,
  ...over,
})
const base = {
  status: "booked" as const,
  hours: 2,
  crewSize: 2,
  crew: [] as { status: string; rate: number }[],
  quote: quote(),
  payouts: null,
  profitOverride: null,
  defaultWage: 15,
}

describe("cardFee", () => {
  it("only charges the fee when they pay by card", () => {
    expect(cardFee(quote({ paymentMethod: "stripe" }))).toBe(6.1)
    expect(cardFee(quote({ paymentMethod: "cash" }))).toBe(0)
    expect(cardFee(quote({ paymentMethod: "check" }))).toBe(0)
    expect(cardFee(quote({ paymentMethod: null }))).toBe(0)
    expect(cardFee(null)).toBe(0)
  })
})

describe("jobMoney", () => {
  it("booked job: each crew member's rate × the job's hours", () => {
    const m = jobMoney({ ...base, crew: [{ status: "accepted", rate: 15 }, { status: "accepted", rate: 20 }, { status: "declined", rate: 99 }] })
    expect(m).toEqual({ price: 200, fee: 0, costs: 0, labor: 70, profit: 130, basis: "crew" })
  })

  it("booked with nobody on it is just the owner: no crew pay", () => {
    expect(jobMoney(base)).toMatchObject({ labor: 0, profit: 200, basis: "owner" })
  })

  it("card payer: fee comes off the take-home", () => {
    const m = jobMoney({ ...base, quote: quote({ paymentMethod: "stripe" }), crew: [{ status: "accepted", rate: 15 }] })
    expect(m).toMatchObject({ fee: 6.1, labor: 30, profit: 163.9 })
  })

  it("recorded payouts win over rates", () => {
    expect(jobMoney({ ...base, status: "done", payouts: 45, crew: [{ status: "accepted", rate: 15 }] })).toMatchObject({ labor: 45, profit: 155, basis: "paid" })
  })

  it("owner-set take-home wins over everything", () => {
    expect(jobMoney({ ...base, profitOverride: 150, payouts: 45 })).toMatchObject({ labor: 50, profit: 150, basis: "set" })
  })

  it("owners doing it: no crew pay, even before it's booked", () => {
    expect(jobMoney({ ...base, ownersWorking: true, crew: [{ status: "accepted", rate: 15 }] })).toMatchObject({ labor: 0, profit: 200, basis: "owner" })
    expect(jobMoney({ ...base, status: "unscheduled", ownersWorking: true })).toMatchObject({ labor: 0, profit: 200 })
    expect(jobMoney({ ...base, status: "done", ownersWorking: true, payouts: 20 })).toMatchObject({ labor: 20, profit: 180 })
  })

  it("not booked yet: the quote's labor estimate", () => {
    expect(jobMoney({ ...base, status: "proposed", crew: [{ status: "accepted", rate: 15 }] })).toMatchObject({ labor: 60, basis: "estimate" })
  })

  it("not booked yet but enough crew said yes: their real rates", () => {
    const crew = [
      { status: "accepted", rate: 18 },
      { status: "accepted", rate: 15 },
    ]
    expect(jobMoney({ ...base, status: "crew_confirmed", crew })).toMatchObject({ labor: 66, basis: "crew" })
  })

  it("no quote: crew size × hours × default wage", () => {
    expect(jobMoney({ ...base, status: "unscheduled", quote: null })).toMatchObject({ price: 0, labor: 60, profit: -60, basis: "estimate" })
  })
})

describe("job costs", () => {
  it("rentals and materials come out of take-home, with crew, owners or a set take-home", () => {
    const quote = { ...base.quote!, costTotal: 95 }
    expect(jobMoney({ ...base, quote, crew: [{ status: "accepted", rate: 15 }, { status: "accepted", rate: 20 }] })).toMatchObject({
      costs: 95,
      labor: 70,
      profit: 35,
    })
    expect(jobMoney({ ...base, quote, ownersWorking: true })).toMatchObject({ costs: 95, labor: 0, profit: 105 })
    expect(jobMoney({ ...base, quote, profitOverride: 80 })).toMatchObject({ costs: 95, labor: 25, profit: 80, basis: "set" })
  })
})

describe("totals", () => {
  it("adds up a day and each crew member's hours, skipping cancelled jobs", () => {
    const m = (price: number, labor: number) => ({ price, fee: 0, costs: 0, labor, profit: price - labor, basis: "crew" as const })
    const t = totals([
      { status: "booked", hours: 2, money: m(200, 60), crew: [{ id: "a", name: "Emma", status: "accepted" }, { id: "b", name: "Michael", status: "accepted" }] },
      { status: "booked", hours: 1.5, money: m(100, 22.5), crew: [{ id: "a", name: "Emma", status: "accepted" }] },
      { status: "cancelled", hours: 3, money: m(500, 0), crew: [{ id: "b", name: "Michael", status: "accepted" }] },
    ])
    expect(t).toMatchObject({ jobs: 2, price: 300, labor: 82.5, profit: 217.5, hours: 3.5 })
    expect(t.crew).toEqual([
      { id: "a", name: "Emma", hours: 3.5 },
      { id: "b", name: "Michael", hours: 2 },
    ])
  })
})

describe("format", () => {
  it("usd / hrs", () => {
    expect(usd(1240)).toBe("$1,240")
    expect(usd(37.5)).toBe("$37.50")
    expect(usd(-12)).toBe("-$12")
    expect(hrs(2.5)).toBe("2.5h")
    expect(hrs(0.75)).toBe("45m")
  })
})
