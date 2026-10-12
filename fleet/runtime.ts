/**
 * The worker loop. Heartbeat every 30 s; otherwise claim → dispatch → complete / fail, sleeping 5 s
 * when idle. Database outages are logged (throttled) and retried forever; the loop never crashes.
 * The host role does not claim: it runs `hostTick` every minute instead.
 */
import type { FleetTask } from "../lib/db/types";
import { enqueueSchedule } from "../lib/ops/tasks";
import { check } from "../lib/ops/types";
import { backoffInterval } from "./backoff";
import type { TaskContext } from "./context";
import { PermanentTaskError } from "./errors";
import { heartbeat, setLastError } from "./heartbeat";
import { errorMessage } from "./log";
import { enqueueWeeklyAdDrafts } from "./tasks/ad_draft";
import { hostTick } from "./tasks/host";
import { dispatch } from "./tasks/index";
import { MINUTE_MS } from "./time";

export type RuntimeOptions = {
  ctx: TaskContext;
  version: string | null;
  heartbeatMs?: number;
  idleMs?: number;
  hostTickMs?: number;
  taskTimeoutMs?: number;
  /** Scheduler self-enqueues a sweep this often (de-duped per 15-minute bucket anyway). */
  scheduleSweepMs?: number;
  /** Ads worker checks whether this week's drafts are due this often. */
  adsCheckMs?: number;
};

type Timings = Required<Omit<RuntimeOptions, "ctx" | "version">>;

export const DEFAULTS: Timings = {
  heartbeatMs: 30_000,
  idleMs: 5_000,
  hostTickMs: 60_000,
  taskTimeoutMs: 8 * MINUTE_MS,
  scheduleSweepMs: 15 * MINUTE_MS,
  adsCheckMs: 10 * MINUTE_MS,
};

/** Resolves after `ms`, or immediately when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** Per kind of failure: log the first one, then at most once a minute while it keeps failing. */
function failureLog(ctx: TaskContext) {
  const state: Record<string, { since: number; lastLog: number; count: number }> = {};
  return {
    fail(what: string, e: unknown) {
      const t = Date.now();
      const s = (state[what] ??= { since: t, lastLog: 0, count: 0 });
      s.count++;
      if (t - s.lastLog >= 60_000) {
        ctx.log.error(`${what} failed`, { err: errorMessage(e), failures: s.count });
        s.lastLog = t;
      }
    },
    ok(what: string) {
      const s = state[what];
      if (!s) return;
      ctx.log.info(`${what} ok again`, { after_s: Math.round((Date.now() - s.since) / 1000), failures: s.count });
      delete state[what];
    },
  };
}

export async function claimTask(ctx: TaskContext): Promise<FleetTask | null> {
  const rows = check(await ctx.db.rpc("claim_task", { p_role: ctx.role, p_worker: ctx.worker }), "claim_task");
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as FleetTask[];
  return list[0] ?? null;
}

const brief = (r: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  return out;
};

/** Run one claimed task and record the outcome. Never throws. */
export async function runTask(ctx: TaskContext, task: FleetTask, timeoutMs: number = DEFAULTS.taskTimeoutMs): Promise<"done" | "retry" | "failed"> {
  const started = Date.now();
  const log = ctx.log.child({ task: task.type, id: task.id.slice(0, 8) });
  log.info("start", { attempt: task.attempts });
  try {
    const result = await withTimeout(dispatch(ctx, task), timeoutMs, task.type);
    check(await ctx.db.rpc("complete_task", { p_id: task.id, p_result: result }), "complete_task");
    log.info("done", { ms: Date.now() - started, ...brief(result) });
    return "done";
  } catch (e) {
    const msg = errorMessage(e).slice(0, 1000);
    let outcome: "retry" | "failed" = "failed";
    try {
      if (e instanceof PermanentTaskError) {
        check(
          await ctx.db
            .from("fleet_tasks")
            .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
            .eq("id", task.id),
          "fail permanently",
        );
      } else {
        const status = check(
          await ctx.db.rpc("fail_task", { p_id: task.id, p_error: msg, p_retry_in: backoffInterval(task.attempts) }),
          "fail_task",
        );
        outcome = status === "queued" ? "retry" : "failed";
      }
    } catch (recordErr) {
      log.error("could not record failure", { err: errorMessage(recordErr) });
    }
    log.error(outcome === "retry" ? "failed, will retry" : "failed", {
      ms: Date.now() - started,
      err: msg,
      ...(outcome === "retry" ? { retry_in: backoffInterval(task.attempts) } : {}),
    });
    try {
      await setLastError(ctx.db, ctx.worker, `${task.type}: ${msg}`);
    } catch {
      /* the failure is already logged */
    }
    return outcome;
  }
}

export async function runWorker(opts: RuntimeOptions, signal: AbortSignal): Promise<void> {
  const o = { ...DEFAULTS, ...opts };
  const { ctx } = o;
  const db$ = failureLog(ctx);
  let currentTask: string | null = null;

  const beat = async () => {
    try {
      await heartbeat(ctx.db, { name: ctx.worker, role: ctx.role, currentTask, version: o.version });
      db$.ok("heartbeat");
    } catch (e) {
      db$.fail("heartbeat", e);
    }
  };
  const lastRun: Record<string, number> = {};
  const due = (key: string, every: number) => {
    const t = Date.now();
    if (lastRun[key] !== undefined && t - lastRun[key] < every) return false;
    lastRun[key] = t;
    return true;
  };

  await beat();
  const hb = setInterval(() => void beat(), o.heartbeatMs);
  try {
    while (!signal.aborted) {
      if (ctx.role === "host") {
        if (due("host", o.hostTickMs)) {
          const r = await hostTick(ctx);
          if (r.errors.length) {
            db$.fail("host tick", new Error(r.errors.join("; ")));
            try {
              await setLastError(ctx.db, ctx.worker, `host: ${r.errors.join("; ")}`);
            } catch {
              /* logged above */
            }
          } else {
            db$.ok("host tick");
            const n = (k: string) => (Array.isArray(r.ok[k]) ? (r.ok[k] as unknown[]).length : r.ok[k]);
            if (n("requeued") || n("offline") || n("reminders") || n("reviews") || n("expired")) {
              ctx.log.info("host tick", {
                requeued: n("requeued"), offline: n("offline"), reminders: n("reminders"), reviews: n("reviews"), expired: n("expired"),
              });
            }
          }
        }
        await sleep(o.idleMs, signal);
        continue;
      }

      await rolePeriodic(ctx, due, o, db$);

      let task: FleetTask | null;
      try {
        task = await claimTask(ctx);
        db$.ok("claim_task");
      } catch (e) {
        db$.fail("claim_task", e);
        await sleep(o.idleMs, signal);
        continue;
      }
      if (!task) {
        await sleep(o.idleMs, signal);
        continue;
      }
      currentTask = `${task.type}:${task.id.slice(0, 8)}`;
      void beat();
      await runTask(ctx, task, o.taskTimeoutMs);
      currentTask = null;
    }
  } finally {
    clearInterval(hb);
    currentTask = null;
    await beat();
  }
}

/** Role-specific self-scheduling (the host also does the schedule sweep; both are de-duped). */
async function rolePeriodic(
  ctx: TaskContext,
  due: (key: string, every: number) => boolean,
  o: Timings,
  db$: { fail(what: string, e: unknown): void },
): Promise<void> {
  try {
    if (ctx.role === "scheduler" && due("schedule", o.scheduleSweepMs)) {
      await enqueueSchedule(ctx.db, "sweep", undefined, ctx.now());
    }
    if (ctx.role === "ads" && due("ads", o.adsCheckMs)) {
      await enqueueWeeklyAdDrafts(ctx.db, ctx.now());
    }
  } catch (e) {
    db$.fail(`${ctx.role} self-enqueue`, e);
  }
}
