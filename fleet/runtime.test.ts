import { describe, expect, it, vi } from "vitest";
import type { FleetTask } from "../lib/db/types";
import { settingsRow } from "../lib/ops/test-utils";
import { heartbeat } from "./heartbeat";
import { claimTask, runTask, runWorker, sleep } from "./runtime";
import { fleetDb, makeCtx } from "./test-helpers";

const T0 = "2026-01-01T00:00:00.000Z";
function task(over: Partial<FleetTask> = {}): FleetTask {
  return {
    id: "f0000000-0000-4000-8000-000000000001", created_at: T0, updated_at: T0, type: "send_message", role: "followup",
    payload: { message_id: "e0000000-0000-4000-8000-000000000001" }, status: "running", worker: "W4", attempts: 1, max_attempts: 5,
    run_after: T0, started_at: T0, finished_at: null, result: null, error: null, dedupe_key: null, ...over,
  };
}
const worker = { id: "w", created_at: T0, updated_at: T0, name: "W4", role: "followup" as const, last_heartbeat: null, cpu: null, ram: null, temp_c: null, current_task: null, last_error: null, version: null };

describe("runTask", () => {
  it("completes a successful task with its result", async () => {
    const db = fleetDb({
      fleet_tasks: [task()],
      fleet_workers: [worker],
      customers: [{ id: "cu1", email: "a@b.test", email_opt_in: false, unsubscribe_token: "t" } as never],
      messages: [{ id: "e0000000-0000-4000-8000-000000000001", customer_id: "cu1", channel: "email", kind: "reminder", subject: "Hi", body: "See you", status: "queued" } as never],
    });
    vi.spyOn(console, "log").mockImplementation(() => {}); // the "log" email provider prints
    const out = await runTask(makeCtx(db, { worker: "W4", role: "followup" }), task());
    expect(out).toBe("done");
    expect(db.tables.fleet_tasks[0]).toMatchObject({ status: "done", result: { status: "sent" } });
    expect(db.tables.messages[0].status).toBe("sent");
  });

  it("fails a retryable error with min(2^attempts, 60) minute backoff and records last_error", async () => {
    const db = fleetDb({ fleet_tasks: [task({ attempts: 3 })], fleet_workers: [worker], messages: [] });
    const out = await runTask(makeCtx(db, { worker: "W4", role: "followup" }), task({ attempts: 3 }));
    expect(out).toBe("retry");
    const call = db.rpcCalls.find((c) => c.fn === "fail_task")!;
    expect(call.args).toMatchObject({ p_id: task().id, p_retry_in: "8 minutes" });
    expect(String(call.args.p_error)).toMatch(/not found/);
    expect(db.tables.fleet_workers[0].last_error).toMatch(/^send_message: .*not found/);
  });

  it("reports failed once attempts run out", async () => {
    const db = fleetDb({ fleet_tasks: [task({ attempts: 5 })], fleet_workers: [worker], messages: [] });
    expect(await runTask(makeCtx(db), task({ attempts: 5 }))).toBe("failed");
    expect(db.rpcCalls.find((c) => c.fn === "fail_task")!.args.p_retry_in).toBe("32 minutes");
  });

  it("fails a bad payload permanently without retrying", async () => {
    const bad = task({ payload: { message: 1 } });
    const db = fleetDb({ fleet_tasks: [bad], fleet_workers: [worker] });
    expect(await runTask(makeCtx(db, { worker: "W4" }), bad)).toBe("failed");
    expect(db.rpcCalls.some((c) => c.fn === "fail_task")).toBe(false);
    expect(db.tables.fleet_tasks[0]).toMatchObject({ status: "failed" });
    expect(String(db.tables.fleet_tasks[0].error)).toMatch(/invalid send_message payload/);
  });

  it("times out a hung task", async () => {
    const db = fleetDb({ fleet_tasks: [task({ type: "weather_watch", payload: {} })], settings: [settingsRow()] });
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    try {
      expect(await runTask(makeCtx(db), task({ type: "weather_watch", payload: {} }), 20)).toBe("retry");
      expect(String(db.rpcCalls.find((c) => c.fn === "fail_task")!.args.p_error)).toMatch(/timed out/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("claim + heartbeat + loop", () => {
  it("claimTask calls claim_task(role, worker) and returns the first row", async () => {
    const db = fleetDb({}, { rpc: { claim_task: () => [task()] } });
    expect((await claimTask(makeCtx(db, { role: "followup", worker: "W4" })))!.id).toBe(task().id);
    expect(db.rpcCalls[0]).toEqual({ fn: "claim_task", args: { p_role: "followup", p_worker: "W4" } });
    expect(await claimTask(makeCtx(fleetDb()))).toBeNull();
  });

  it("heartbeat upserts by name and clears the host's offline note", async () => {
    const db = fleetDb({ fleet_workers: [{ ...worker, last_error: "no heartbeat" }] });
    await heartbeat(db, { name: "W4", role: "followup", currentTask: "quote:abcd", version: "abc1234", metrics: { cpu: 12.5, ram: 40, temp_c: 51.2 } });
    await heartbeat(db, { name: "W9", role: "ads", currentTask: null, version: null, metrics: { cpu: 1, ram: 2, temp_c: null } });
    expect(db.tables.fleet_workers).toHaveLength(2);
    expect(db.tables.fleet_workers[0]).toMatchObject({ name: "W4", cpu: 12.5, temp_c: 51.2, current_task: "quote:abcd", version: "abc1234", last_error: null });
    expect(db.tables.fleet_workers[1]).toMatchObject({ name: "W9", role: "ads" });
  });

  it("the loop claims, runs, sleeps, and stops cleanly on abort; DB errors never crash it", async () => {
    let n = 0;
    const db = fleetDb(
      { fleet_tasks: [task({ type: "send_message", payload: { message_id: "bad" } })], fleet_workers: [] },
      {
        rpc: {
          claim_task: () => {
            n++;
            if (n === 1) throw new Error("connection refused");
            return n === 2 ? [task({ payload: { message_id: "bad" } })] : [];
          },
        },
      },
    );
    const stop = new AbortController();
    const ctx = makeCtx(db, { role: "followup", worker: "W4" });
    const done = runWorker({ ctx, version: "t", idleMs: 5, heartbeatMs: 1000 }, stop.signal);
    while (n < 4) await sleep(5);
    stop.abort();
    await done;
    expect(db.tables.fleet_tasks[0].status).toBe("failed"); // bad payload → permanent
    expect(db.tables.fleet_workers[0]).toMatchObject({ name: "W4", current_task: null });
  });

  it("the scheduler self-enqueues a sweep; the ads worker enqueues weekly drafts", async () => {
    const run = async (role: "scheduler" | "ads") => {
      const db = fleetDb({ settings: [settingsRow()] });
      const stop = new AbortController();
      const ctx = makeCtx(db, { role, worker: role, now: () => new Date("2026-10-13T14:00:00Z") });
      const done = runWorker({ ctx, version: null, idleMs: 5 }, stop.signal);
      await sleep(30);
      stop.abort();
      await done;
      return db.tables.fleet_tasks ?? [];
    };
    expect((await run("scheduler")).map((t) => t.type)).toEqual(["schedule"]);
    const ads = await run("ads");
    expect(ads.map((t) => t.dedupe_key)).toEqual(["ad_draft:facebook:2026-W42", "ad_draft:instagram:2026-W42", "ad_draft:nextdoor:2026-W42"]);
    expect(ads[0].payload).toMatchObject({ channel: "facebook", season: "fall", offer: expect.any(String) });
  });
});
