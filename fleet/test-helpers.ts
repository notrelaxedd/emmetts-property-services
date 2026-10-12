/**
 * Test-only helpers for the fleet: the shared `fakeDb` plus the few things fleet code uses that it
 * lacks (range filters, upsert, storage signed URLs, the task-queue RPCs), and a TaskContext builder.
 * Imported only by *.test.ts.
 */
import { vi } from "vitest";
import type { FakeDb, FakeTables, RpcHandler } from "../lib/ops/test-utils";
import { fakeDb } from "../lib/ops/test-utils";
import type { AiHelpers, TaskContext } from "./context";
import { silentLogger } from "./log";

type Rec = Record<string, unknown>;
type Filterable = { filters: ((r: Rec) => boolean)[] };

const RANGE: Record<string, (a: unknown, b: unknown) => boolean> = {
  gte: (a, b) => (a as string) >= (b as string),
  gt: (a, b) => (a as string) > (b as string),
  lte: (a, b) => (a as string) <= (b as string),
  lt: (a, b) => (a as string) < (b as string),
};

export type FleetFakeDb = FakeDb & { signedUrls: string[] };

export function fleetDb(initial: FakeTables = {}, opts: { rpc?: Record<string, RpcHandler>; now?: () => string } = {}): FleetFakeDb {
  const db = fakeDb(initial, {
    ...opts,
    rpc: {
      claim_task: () => [],
      complete_task: (args, d) => {
        const t = d.tables.fleet_tasks?.find((r) => r.id === args.p_id);
        if (t) Object.assign(t, { status: "done", result: args.p_result, error: null });
        return null;
      },
      fail_task: (args, d) => {
        const t = d.tables.fleet_tasks?.find((r) => r.id === args.p_id);
        if (!t) return null;
        const out = (t.attempts as number) >= (t.max_attempts as number) ? "failed" : "queued";
        Object.assign(t, { status: out, error: args.p_error, retry_in: args.p_retry_in });
        return out;
      },
      requeue_stale_tasks: () => 0,
      ai_spend_this_month: () => 0,
      ...opts.rpc,
    },
  }) as FleetFakeDb;

  // Range filters (the shared fake only has eq / neq / in / is).
  const proto = Object.getPrototypeOf(db.from("settings")) as Rec;
  for (const [name, cmp] of Object.entries(RANGE)) {
    if (typeof proto[name] === "function") continue;
    proto[name] = function (this: Filterable, col: string, v: unknown) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined && cmp(r[col], v));
      return this;
    };
  }

  // upsert(row, { onConflict }) on top of from().
  const from = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t as "settings") as unknown as Rec;
    q.upsert = (row: Rec, o: { onConflict?: string } = {}) => {
      const key = o.onConflict ?? "id";
      const rows = (db.tables[t] ??= []);
      const hit = rows.find((r) => r[key] === row[key]);
      const now = new Date().toISOString();
      if (hit) Object.assign(hit, row, { updated_at: now });
      else rows.push({ id: crypto.randomUUID(), created_at: now, updated_at: now, ...row });
      return Promise.resolve({ data: null, error: null });
    };
    return q;
  };

  // storage.from(bucket).createSignedUrl(path, secs)
  db.signedUrls = [];
  (db as unknown as Rec).storage = {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, secs: number) => {
        const url = `https://signed.test/${bucket}/${path}?ttl=${secs}`;
        db.signedUrls.push(url);
        return { data: { signedUrl: url }, error: null };
      },
    }),
  };
  return db;
}

export function fakeAi(over: Partial<AiHelpers> = {}): { [K in keyof AiHelpers]: ReturnType<typeof vi.fn> & AiHelpers[K] } {
  const ai = {
    draftAd: vi.fn(async () => ({ headline: "Fall leaf cleanup in Rocky River", body: "We rake, blow and haul.", cta: "Get a quote" })),
    draftMessage: vi.fn(async (_db: unknown, input: { kind: string }) => ({ subject: `AI ${input.kind}`, body: `AI body for ${input.kind}` })),
    summarizeCustomRequest: vi.fn(async () => ({
      summary: "Remove one dead maple near the garage.", crew_size: 3, hours_min: 4, hours_max: 6, price_min: 600, price_max: 900, risks: ["near power line"],
    })),
    estimateFromPhotos: vi.fn(async () => ({ tree_cover: "heavy" as const, confidence: 0.8, notes: "many trees" })),
    ...over,
  };
  return ai as never;
}

export function makeCtx(db: FakeDb, over: Partial<TaskContext> = {}): TaskContext {
  return {
    db,
    worker: "test-worker",
    role: "quotes",
    siteUrl: "https://example.test",
    ai: fakeAi(),
    log: silentLogger,
    now: () => new Date("2026-10-12T14:00:00.000Z"),
    ...over,
  };
}
