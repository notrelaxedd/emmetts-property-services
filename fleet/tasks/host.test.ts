import { describe, expect, it } from "vitest";
import { jobRow, settingsRow } from "../../lib/ops/test-utils";
import { fleetDb, makeCtx } from "../test-helpers";
import { enqueueReminders, enqueueReviews, expireQuotes, hostTick, markOfflineWorkers } from "./host";

const NOW = new Date("2026-10-12T14:00:00.000Z");
const inH = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const T0 = "2026-01-01T00:00:00.000Z";

describe("host", () => {
  it("enqueues a reminder only for booked jobs starting in 20–28 h, once per job", async () => {
    const db = fleetDb({
      jobs: [
        jobRow({ id: "early", status: "booked", start_at: inH(19.9) }),
        jobRow({ id: "lo", status: "booked", start_at: inH(20) }),
        jobRow({ id: "mid", status: "booked", start_at: inH(24) }),
        jobRow({ id: "hi", status: "booked", start_at: inH(28) }),
        jobRow({ id: "late", status: "booked", start_at: inH(28.1) }),
        jobRow({ id: "notbooked", status: "proposed", start_at: inH(24) }),
      ],
    });
    expect((await enqueueReminders(db, NOW)).sort()).toEqual(["hi", "lo", "mid"]);
    await enqueueReminders(db, NOW); // next minute: de-duped
    expect(db.tables.fleet_tasks.map((t) => [t.type, t.dedupe_key, (t.payload as { job_id: string }).job_id]).sort()).toEqual([
      ["followup_reminder", "reminder:hi", "hi"],
      ["followup_reminder", "reminder:lo", "lo"],
      ["followup_reminder", "reminder:mid", "mid"],
    ]);
    expect(db.tables.fleet_tasks.every((t) => t.role === "followup")).toBe(true);
  });

  it("enqueues review requests for jobs done 24–72 h ago", async () => {
    const db = fleetDb({
      jobs: [
        jobRow({ id: "fresh", status: "done", completed_at: inH(-2) }),
        jobRow({ id: "yesterday", status: "done", completed_at: inH(-30) }),
        jobRow({ id: "old", status: "done", completed_at: inH(-100) }),
      ],
    });
    expect(await enqueueReviews(db, NOW)).toEqual(["yesterday"]);
    expect(db.tables.fleet_tasks[0]).toMatchObject({ type: "followup_review", dedupe_key: "review:yesterday" });
  });

  it("marks silent workers offline once and expires old quotes", async () => {
    const w = (name: string, hb: string | null, over = {}) => ({
      id: name, created_at: T0, updated_at: T0, name, role: "quotes" as const, last_heartbeat: hb, cpu: 1, ram: 1, temp_c: null,
      current_task: "quote:1234", last_error: null, version: null, ...over,
    });
    const db = fleetDb({
      fleet_workers: [w("W1", inH(-0.01)), w("W2", inH(-1)), w("W3", inH(-1), { current_task: null, last_error: "no heartbeat" }), w("host", inH(-1))],
      quotes: [
        { id: "q1", status: "sent", expires_at: inH(-1) } as never,
        { id: "q2", status: "sent", expires_at: inH(5) } as never,
        { id: "q3", status: "accepted", expires_at: inH(-1) } as never,
      ],
    });
    expect(await markOfflineWorkers(db, NOW, "host")).toEqual(["W2"]);
    expect(db.tables.fleet_workers.find((r) => r.name === "W2")).toMatchObject({ current_task: null, last_error: "no heartbeat" });
    expect(db.tables.fleet_workers.find((r) => r.name === "W1")).toMatchObject({ current_task: "quote:1234", last_error: null });
    expect(await expireQuotes(db, NOW)).toBe(1);
    expect(db.tables.quotes.map((q) => q.status)).toEqual(["expired", "sent", "accepted"]);
  });

  it("a tick runs every step, enqueues weather + schedule, and reports step errors without throwing", async () => {
    const db = fleetDb({ settings: [settingsRow()], jobs: [] }, { rpc: { requeue_stale_tasks: () => 2 } });
    const ctx = makeCtx(db, { role: "host", worker: "host", now: () => NOW });
    const r = await hostTick(ctx);
    expect(r.errors).toEqual([]);
    expect(r.ok.requeued).toBe(2);
    expect(db.rpcCalls.find((c) => c.fn === "requeue_stale_tasks")!.args).toEqual({ p_stale: "10 minutes" });
    expect(db.tables.fleet_tasks.map((t) => [t.type, t.dedupe_key])).toEqual([
      ["weather_watch", "weather:2026-10-12-1"],
      ["schedule", `schedule:${Math.floor(NOW.getTime() / 900_000)}`],
    ]);
    await hostTick(ctx); // same minute: nothing new
    expect(db.tables.fleet_tasks).toHaveLength(2);

    const broken = fleetDb({}, { rpc: { requeue_stale_tasks: () => { throw new Error("db down"); } } });
    const r2 = await hostTick(makeCtx(broken, { role: "host", now: () => NOW }));
    expect(r2.errors[0]).toMatch(/^requeued: .*db down/);
    expect(r2.ok.weather).toBeTruthy(); // later steps still ran
  });
});
