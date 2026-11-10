import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sendMessage: vi.fn(), draftMessage: vi.fn() }));
vi.mock("../email", async (importOriginal) => ({ ...(await importOriginal<typeof import("../email")>()), sendMessage: m.sendMessage }));
vi.mock("../ai/claude", () => ({ draftMessage: m.draftMessage }));

import { at, crew, weekdays } from "../scheduler/fixtures";
import { bookJob, scheduleJobAt } from "./booking";
import { createOwnerJob } from "./owner-jobs";
import { customerRow, fakeDb, settingsRow } from "./test-utils";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  m.sendMessage.mockResolvedValue({ status: "sent", providerId: "p1" });
  m.draftMessage.mockRejectedValue(new Error("AI off in tests"));
});

// The same steps app/admin/actions/schedule.ts `scheduleForCustomer` runs.
describe("scheduling a job by hand, end to end", () => {
  it("creates the job, puts it on the calendar with only the ticked crew, and books it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at("2026-10-05", "12:00")));
    try {
      const db = fakeDb({
        settings: [settingsRow({ default_wage: 15 })],
        profiles: [crew("A", "Ann Lee", { email: "ann@example.test" }), crew("B", "Bo Diaz", { email: "bo@example.test" })],
        crew_availability: [...weekdays("A"), ...weekdays("B")],
        customers: [customerRow({ id: "c1", name: "Pat Smith", email: "pat@example.test", address: "1 Lake Rd" })],
      });
      const { job } = await createOwnerJob(db, {
        customerId: "c1", description: "Mulching", price: 200, hours: 2, crewSize: 1, paymentMethod: "check", recordedBy: "owner@example.test",
      });
      const start = new Date(at("2026-10-12", "09:00"));
      const end = new Date(at("2026-10-12", "11:00"));
      const ctx = { actor: "owner@example.test", siteUrl: "https://x.test" };
      const placed = await scheduleJobAt(db, job.id, start, end, { ...ctx, crewIds: ["A"] });
      expect(placed.asked).toBe(1);
      const res = await bookJob(db, job.id, { paymentMethod: "check", crewIds: ["A"], ...ctx, note: null });

      expect(res.job).toMatchObject({ status: "booked", start_at: start.toISOString(), end_at: end.toISOString(), crew_size: 1 });
      expect(db.tables.job_assignments.map((a) => [a.crew_id, a.status])).toEqual([["A", "accepted"]]);
      expect(db.tables.quotes[0]).toMatchObject({ status: "accepted", payment_method: "check", paid_at: null });
      expect(res.confirmationSent).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
