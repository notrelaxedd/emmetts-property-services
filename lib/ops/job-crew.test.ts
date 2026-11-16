import { describe, expect, it } from "vitest";
import { crewChangeEmail } from "./job-crew";

const job = { start_at: "2026-11-18T21:00:00.000Z", end_at: "2026-11-18T22:00:00.000Z", est_minutes: 60 };

describe("crewChangeEmail", () => {
  it("tells someone they're on a job, with where and when", () => {
    const m = crewChangeEmail({ crewName: "Addy Smith", on: true, customerName: "Jones", address: "1 Lake Rd", services: ["Leaves"], job, siteUrl: "https://eodlawns.com/" });
    expect(m.subject).toMatch(/^You're on: Leaves for Jones/);
    expect(m.text).toContain("Hi Addy,");
    expect(m.text).toContain("1 Lake Rd");
    expect(m.text).toContain("https://eodlawns.com/crew");
  });

  it("tells someone they're off a job", () => {
    const m = crewChangeEmail({ crewName: "Addy", on: false, customerName: "Jones", address: null, services: [], job, siteUrl: "https://eodlawns.com" });
    expect(m.subject).toMatch(/^You're off: a job for Jones/);
    expect(m.text).toContain("taken off");
    expect(m.html).not.toContain("crew app");
  });
});
