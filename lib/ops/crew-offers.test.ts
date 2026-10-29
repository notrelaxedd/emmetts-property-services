import { describe, expect, it, vi } from "vitest";
import { at, block, crew, crewException, weekdays } from "../scheduler/fixtures";
import { crewOfferEmail, eligibleCrewForSlot, pollCrewForJob, respondUrl } from "./crew-offers";
import { customerRow, fakeDb, jobRow } from "./test-utils";

const T = "2026-01-01T00:00:00.000Z";
const slot = { start: new Date(at("2026-10-12", "09:00")), end: new Date(at("2026-10-12", "11:00")) }; // Monday

describe("eligibleCrewForSlot", () => {
  const A = crew("A", "Ann Lee");
  const B = crew("B", "Bo Diaz");
  const C = crew("C", "Cy Park", { paused: true });
  const D = crew("D", "Di Fox", { removed_at: T });
  const E = crew("E", "Ed Roy"); // never set any hours

  it("asks crew whose hours cover the slot, crew with no hours at all, and nobody paused, removed, off or busy", () => {
    const out = eligibleCrewForSlot({
      ...slot,
      crew: [A, B, C, D, E],
      crewAvailability: [...weekdays("A"), ...weekdays("B"), ...weekdays("C"), block("D", 1, "08:00", "17:00")],
      crewExceptions: [crewException("B", "2026-10-12")],
      busy: [],
    });
    expect(out.eligible.map((c) => c.id)).toEqual(["A", "E"]);
    expect(out.skipped.map((s) => [s.crew.id, s.why])).toEqual([
      ["B", "time_off"],
      ["C", "paused"],
      ["D", "removed"],
    ]);
  });

  it("skips crew whose weekly hours don't cover the slot, and crew already holding another job then", () => {
    const out = eligibleCrewForSlot({
      ...slot,
      crew: [A, B],
      crewAvailability: [block("A", 1, "12:00", "17:00"), ...weekdays("B")],
      crewExceptions: [],
      busy: [{ crew_id: "B", job_id: "other", status: "accepted", start_at: at("2026-10-12", "10:00"), end_at: at("2026-10-12", "12:00") }],
    });
    expect(out.eligible).toEqual([]);
    expect(out.skipped.map((s) => [s.crew.id, s.why])).toEqual([
      ["A", "unavailable"],
      ["B", "busy"],
    ]);
  });

  it("the job's own rows never make anyone busy (re-polling after a move)", () => {
    const out = eligibleCrewForSlot({
      ...slot,
      jobId: "j1",
      crew: [A],
      crewAvailability: weekdays("A"),
      crewExceptions: [],
      busy: [{ crew_id: "A", job_id: "j1", status: "accepted", start_at: at("2026-10-12", "09:00"), end_at: at("2026-10-12", "11:00") }],
    });
    expect(out.eligible.map((c) => c.id)).toEqual(["A"]);
  });
});

describe("pollCrewForJob", () => {
  const seed = () =>
    fakeDb({
      profiles: [crew("A", "Ann Lee", { email: "ann@example.test" }), crew("B", "Bo Diaz", { email: null }), crew("C", "Cy Park", { email: "cy@example.test" })],
      crew_availability: [...weekdays("A"), ...weekdays("B"), block("C", 1, "13:00", "17:00")],
      customers: [customerRow({ id: "c1", name: "Pat Smith", address: "1 Lake Rd" })],
      jobs: [jobRow({ id: "j1", customer_id: "c1", status: "proposed", crew_size: 2, est_minutes: 120, start_at: slot.start.toISOString(), end_at: slot.end.toISOString() })],
    });

  it("creates offers for the eligible crew, emails those with an address, and marks the rest as notified", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const db = seed();
    const job = db.tables.jobs[0] as never;
    const res = await pollCrewForJob(db, job, { siteUrl: "https://x.test", reset: true });
    expect(res.asked.sort()).toEqual(["A", "B"]);
    expect(res.skipped).toEqual([{ crew_id: "C", name: "Cy Park", why: "unavailable" }]);
    expect(res.emailed).toBe(1); // Bo has no email
    const rows = db.tables.job_assignments.map((a) => [a.crew_id, a.status, a.notified_at !== null]).sort();
    expect(rows).toEqual([
      ["A", "offered", true],
      ["B", "offered", true],
    ]);
    expect(db.tables.job_assignments.every((a) => /^[0-9a-f]{32}$/.test(String(a.respond_token)))).toBe(true);
  });

  it("reset re-asks everyone (answers cleared), drops crew who can't make the new slot, and withdraws swaps", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const db = seed();
    db.tables.job_assignments = [
      { id: "a1", created_at: T, updated_at: T, job_id: "j1", crew_id: "A", status: "accepted", responded_at: T, swap_to_crew_id: null, respond_token: "t1", notified_at: T },
      { id: "a3", created_at: T, updated_at: T, job_id: "j1", crew_id: "C", status: "accepted", responded_at: T, swap_to_crew_id: null, respond_token: "t3", notified_at: T },
      { id: "s2", created_at: T, updated_at: T, job_id: "j1", crew_id: "B", status: "swap_offered", responded_at: null, swap_to_crew_id: "A", respond_token: "t2", notified_at: null },
    ];
    const res = await pollCrewForJob(db, db.tables.jobs[0] as never, { siteUrl: "https://x.test", reset: true });
    expect(res.asked.sort()).toEqual(["A", "B"]);
    const byCrew = Object.fromEntries(db.tables.job_assignments.map((a) => [a.crew_id, a]));
    expect(byCrew.A).toMatchObject({ id: "a1", status: "offered", responded_at: null }); // same row, asked again
    expect(byCrew.A.respond_token).toBe("t1"); // the link in an older email still works
    expect(byCrew.B).toMatchObject({ status: "offered", swap_to_crew_id: null });
    expect(byCrew.C).toBeUndefined(); // 9am is outside Cy's hours now
  });

  it("without reset only tops up: existing answers stand", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const db = seed();
    db.tables.job_assignments = [
      { id: "a1", created_at: T, updated_at: T, job_id: "j1", crew_id: "A", status: "declined", responded_at: T, swap_to_crew_id: null, respond_token: "t1", notified_at: T },
    ];
    await pollCrewForJob(db, db.tables.jobs[0] as never, { siteUrl: "https://x.test", reset: false });
    expect(db.tables.job_assignments.map((a) => [a.crew_id, a.status]).sort()).toEqual([
      ["A", "declined"],
      ["B", "offered"],
    ]);
  });
});

describe("crewOfferEmail", () => {
  it("names the job and carries both one-tap links", () => {
    const mail = crewOfferEmail({
      crewName: "Ann Lee",
      customerName: "Pat Smith",
      address: "1 Lake Rd",
      services: ["Leaf cleanup", "Edging"],
      job: { start_at: slot.start.toISOString(), end_at: slot.end.toISOString(), est_minutes: 120, crew_size: 2 },
      token: "abc",
      siteUrl: "https://x.test/",
    });
    expect(mail.subject).toBe("Are you free Mon Oct 12? Leaf cleanup, Edging for Pat Smith");
    expect(mail.text).toContain("Hi Ann,");
    expect(mail.text).toContain("Mon Oct 12, 9:00–11:00am (2h)");
    expect(mail.text).toContain("Crew of 2.");
    expect(mail.text).toContain(respondUrl("https://x.test", "abc", "available"));
    expect(mail.text).toContain("https://x.test/respond/abc?r=cant");
    expect(mail.html).toContain("I&#39;m available");
    expect(mail.text).not.toMatch(/\$/); // never the price
  });
});
