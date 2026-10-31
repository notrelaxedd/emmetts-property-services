import { describe, expect, it } from "vitest"
import { upcomingWeekend } from "@/components/admin/stages/weekend"

describe("upcomingWeekend", () => {
  it("is this Saturday on a weekday, today on a Saturday, next week on a Sunday", () => {
    // Noon UTC is the same calendar day in New York.
    expect(upcomingWeekend(new Date("2026-10-28T16:00:00Z"))).toEqual({ sat: "2026-10-31", sun: "2026-11-01" }) // Wed
    expect(upcomingWeekend(new Date("2026-10-31T16:00:00Z"))).toEqual({ sat: "2026-10-31", sun: "2026-11-01" }) // Sat
    expect(upcomingWeekend(new Date("2026-11-01T16:00:00Z"))).toEqual({ sat: "2026-11-07", sun: "2026-11-08" }) // Sun
  })
})
