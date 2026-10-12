import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/weather", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/weather")>();
  return { ...real, getForecast: vi.fn() };
});

import type { NwsPeriod } from "../../lib/weather";
import { getForecast } from "../../lib/weather";
import { customerRow, jobRow, settingsRow } from "../../lib/ops/test-utils";
import { fakeAi, fleetDb, makeCtx } from "../test-helpers";
import { runWeatherWatch } from "./weather_watch";

// Monday Oct 12 2026, 10:00 EDT.
const NOW = new Date("2026-10-12T14:00:00.000Z");
const period = (name: string, start: string, end: string, short: string, pop: number, detail = short): NwsPeriod => ({
  name, startTime: start, endTime: end, shortForecast: short, detailedForecast: detail, probabilityOfPrecipitation: { value: pop },
});
const SNOWY_AND_RAINY: NwsPeriod[] = [
  period("Today", "2026-10-12T10:00:00-04:00", "2026-10-12T18:00:00-04:00", "Sunny", 0),
  period("Tonight", "2026-10-12T18:00:00-04:00", "2026-10-13T06:00:00-04:00", "Snow Showers", 80, "Snow. New snow accumulation of 2 to 4 inches."),
  period("Tuesday", "2026-10-13T06:00:00-04:00", "2026-10-13T18:00:00-04:00", "Rain Showers Likely", 70),
  period("Wednesday", "2026-10-14T06:00:00-04:00", "2026-10-14T18:00:00-04:00", "Chance Rain", 30),
];

function seed() {
  return fleetDb({
    settings: [settingsRow({ base_lat: 41.5, base_lng: -81.8 })],
    customers: [
      customerRow({ id: "c1", name: "Pat", email: "pat@x.test", email_opt_in: true, snow_list: true }),
      customerRow({ id: "c2", name: "Lee", email: "lee@x.test", email_opt_in: true, snow_list: true }),
      customerRow({ id: "c3", name: "Sam", email: "sam@x.test", email_opt_in: false, snow_list: true }),
      customerRow({ id: "c4", name: "Kim", email: null, email_opt_in: true, snow_list: true }),
      customerRow({ id: "c5", name: "Bo", email: "bo@x.test", email_opt_in: true, snow_list: false }),
    ],
    jobs: [
      jobRow({ id: "rainy1", status: "booked", start_at: "2026-10-13T13:00:00.000Z" }), // Tue 9am EDT
      jobRow({ id: "rainy2", status: "booked", start_at: "2026-10-13T17:00:00.000Z" }), // Tue 1pm EDT
      jobRow({ id: "dry", status: "booked", start_at: "2026-10-14T13:00:00.000Z" }), // Wed, 30% only
      jobRow({ id: "held", status: "booked", weather_hold: true, start_at: "2026-10-13T15:00:00.000Z" }),
      jobRow({ id: "proposed", status: "proposed", start_at: "2026-10-13T15:00:00.000Z" }),
    ],
  });
}

describe("weather_watch task", () => {
  beforeEach(() => vi.mocked(getForecast).mockReset().mockResolvedValue(SNOWY_AND_RAINY));

  it("drafts one snow plan for opted-in snow-list customers and proposes rain holds", async () => {
    const db = seed();
    const ai = fakeAi();
    const res = await runWeatherWatch(makeCtx(db, { ai, now: () => NOW, role: "followup" }), {});

    expect(getForecast).toHaveBeenCalledWith({ lat: 41.5, lng: -81.8 });
    expect(ai.draftMessage).toHaveBeenCalledTimes(1); // drafted once, reused for everyone
    expect(ai.draftMessage.mock.calls[0][1]).toMatchObject({ kind: "snow" });

    const msgs = db.tables.messages;
    expect(msgs.map((m) => m.customer_id).sort()).toEqual(["c1", "c2"]);
    expect(msgs.every((m) => m.kind === "snow" && m.status === "draft" && m.subject === "AI snow")).toBe(true);

    const snow = db.tables.approvals.find((a) => a.kind === "followup")!;
    expect(snow).toMatchObject({ ref_table: "messages", status: "pending", title: "Snow plan email to 2 customers" });
    expect(snow.payload).toMatchObject({ kind: "snow", subject: "AI snow", body: "AI body for snow" });
    expect(((snow.payload as { message_ids: string[] }).message_ids).sort()).toEqual(msgs.map((m) => m.id as string).sort());

    const hold = db.tables.approvals.find((a) => a.kind === "weather_hold")!;
    expect(hold).toMatchObject({
      ref_table: "jobs", ref_id: "rainy1", title: "Rain Tue Oct 13: hold 2 jobs?",
      payload: { job_ids: ["rainy1", "rainy2"], day: "2026-10-13" },
    });
    expect(db.tables.approvals).toHaveLength(2);
    expect(res).toMatchObject({ snow: true, rain: true });
  });

  it("does not repeat itself on the next 6-hour run", async () => {
    const db = seed();
    const ctx = makeCtx(db, { now: () => NOW, role: "followup" });
    await runWeatherWatch(ctx, {});
    db.tables.approvals.find((a) => a.kind === "weather_hold")!.status = "rejected";
    const later = makeCtx(db, { now: () => new Date(NOW.getTime() + 6 * 3_600_000), role: "followup" });
    const res = await runWeatherWatch(later, {});
    expect(db.tables.messages).toHaveLength(2);
    expect(db.tables.approvals).toHaveLength(2);
    expect(res.snow_result).toMatchObject({ skipped: expect.stringMatching(/already drafted/) });
    expect(res.rain_result).toMatchObject({ holds: 0 });
  });

  it("falls back to the template when the AI draft fails, and autopilot sends the whole batch", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {}); // the "log" email provider prints
    const db = seed();
    db.tables.settings[0].autopilot = { ...settingsRow().autopilot, followup: { enabled: true } };
    const ai = fakeAi({ draftMessage: vi.fn(async () => { throw new Error("AI monthly cap reached"); }) });
    await runWeatherWatch(makeCtx(db, { ai, now: () => NOW, role: "followup" }), {});
    expect(db.tables.messages[0].subject).toMatch(/Snow is on the way/);
    expect(db.tables.approvals.find((a) => a.kind === "followup")).toMatchObject({ status: "approved", decided_by: "autopilot" });
    expect(db.tables.messages.map((m) => m.status)).toEqual(["sent", "sent"]); // via the followup handler's message_ids
  });

  it("weather_hold autopilot applies the hold: the day's jobs are held and marked for re-planning", async () => {
    const db = seed();
    db.tables.settings[0].autopilot = { ...settingsRow().autopilot, weather_hold: { enabled: true } };
    const res = await runWeatherWatch(makeCtx(db, { now: () => NOW, role: "followup" }), {});
    expect(db.tables.approvals.find((a) => a.kind === "weather_hold")).toMatchObject({ status: "approved", decided_by: "autopilot" });
    const jobs = Object.fromEntries(db.tables.jobs.map((j) => [j.id, j]));
    for (const id of ["rainy1", "rainy2"]) expect(jobs[id]).toMatchObject({ weather_hold: true, resolve_reason: "weather_hold" });
    expect(jobs.dry).toMatchObject({ weather_hold: false, resolve_reason: null });
    expect(db.tables.fleet_tasks.find((t) => t.type === "schedule")?.payload).toEqual({ reason: "weather_hold", job_ids: ["rainy1", "rainy2"] });
    expect(res.rain_result).toMatchObject({ holds: 1, auto_held: 2 });
  });

  it("does nothing on a dry, warm forecast", async () => {
    vi.mocked(getForecast).mockResolvedValue([SNOWY_AND_RAINY[0], SNOWY_AND_RAINY[3]]);
    const db = seed();
    const res = await runWeatherWatch(makeCtx(db, { now: () => NOW }), {});
    expect(res).toEqual({ snow: false, rain: false });
    expect(db.tables.approvals ?? []).toHaveLength(0);
  });
});
