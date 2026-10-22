import { describe, expect, it } from "vitest"
import { generateTempPassword, TEMP_PASSWORD_ALPHABET } from "./temp-password"

describe("generateTempPassword", () => {
  it("is at least 8 characters and only uses unambiguous symbols", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword()
      expect(pw).toMatch(/^mow-[a-z0-9]{4}-[a-z0-9]{4}$/)
      expect(pw.length).toBeGreaterThanOrEqual(8)
      for (const ch of pw.slice(4).replace(/-/g, "")) expect(TEMP_PASSWORD_ALPHABET).toContain(ch)
    }
    expect(TEMP_PASSWORD_ALPHABET).not.toMatch(/[0O1lI5S8B2Z]/)
  })

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()))
    expect(seen.size).toBe(500)
  })
})
