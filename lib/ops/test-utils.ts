/**
 * In-memory fake of the supabase-js client, for unit tests. No network, no server-only/next imports.
 *
 *   const db = fakeDb({ approvals: [row], settings: [settingsRow] });
 *   await createApproval(db, ...);
 *   db.tables.approvals  // live arrays: assert on them directly
 *   db.rpcCalls          // [{ fn, args }] for every rpc()
 *
 * Supported chain (everything else throws "fakeDb: unsupported ..."):
 *   from(t).select(cols?)                      cols ignored: always returns whole rows
 *     .eq(col, v) .neq(col, v) .in(col, vs) .is(col, v)      filters (AND-ed, strict equality)
 *     .order(col, { ascending? }) .limit(n)
 *     .maybeSingle()  -> row | null (error if > 1)   .single() -> row (error PGRST116 if 0 or > 1)
 *     or await it directly -> { data: rows[], error }
 *   from(t).insert(rowOrRows)[.select()[.single()]]   fills id / created_at / updated_at if absent
 *   from(t).update(patch).eq(...)...[.select()[.single()|.maybeSingle()]]   merges patch, bumps updated_at
 *   from(t).delete().eq(...)...
 *   rpc(fn, args)                              handler from opts.rpc, else built-in `enqueue_task`
 *                                              (inserts into fleet_tasks, de-dupes on dedupe_key)
 * Results are always { data, error }; errors never throw, same as supabase-js.
 * Returned rows are copies, so mutating them does not touch the tables.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./types";
import type { Row, TableName } from "../db/types";

export type FakeTables = { [T in TableName]?: Partial<Row<T>>[] };
export type RpcHandler = (args: Record<string, unknown>, db: FakeDb) => unknown;
type FakeError = { message: string; code?: string };
type Result = { data: unknown; error: FakeError | null };

export type FakeDb = Db & {
  /** Live backing arrays, keyed by table name (created on first use). */
  tables: Record<string, Record<string, unknown>[]>;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
};

export function fakeDb(
  initial: FakeTables = {},
  opts: { rpc?: Record<string, RpcHandler>; now?: () => string } = {},
): FakeDb {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = (v as Record<string, unknown>[]).map((r) => ({ ...r }));
  const rpcCalls: FakeDb["rpcCalls"] = [];
  const now = opts.now ?? (() => new Date().toISOString());
  const table = (t: string) => (tables[t] ??= []);
  const copy = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

  const builtinRpc: Record<string, RpcHandler> = {
    enqueue_task(args) {
      const key = args.p_dedupe_key as string | undefined;
      const rows = table("fleet_tasks");
      if (key) {
        const hit = rows.find((r) => r.dedupe_key === key);
        if (hit) return hit.id;
      }
      const id = randomUUID();
      rows.push({
        id,
        type: args.p_type,
        role: args.p_role,
        payload: args.p_payload,
        status: "queued",
        worker: null,
        attempts: 0,
        max_attempts: 3,
        run_after: (args.p_run_after as string | undefined) ?? now(),
        dedupe_key: key ?? null,
        created_at: now(),
        updated_at: now(),
      });
      return id;
    },
  };

  class Query implements PromiseLike<Result> {
    private filters: ((r: Record<string, unknown>) => boolean)[] = [];
    private orderBy: { col: string; asc: boolean }[] = [];
    private max: number | null = null;
    private mode: "select" | "insert" | "update" | "delete" = "select";
    private payload: unknown;
    private returning = false; // .select() after a write
    private one: "single" | "maybe" | null = null;

    constructor(private t: string) {}

    select(_cols?: string) {
      if (this.mode !== "select") this.returning = true;
      return this;
    }
    insert(rows: unknown) {
      this.mode = "insert";
      this.payload = rows;
      return this;
    }
    update(patch: unknown) {
      this.mode = "update";
      this.payload = patch;
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    eq(col: string, v: unknown) {
      this.filters.push((r) => r[col] === v);
      return this;
    }
    neq(col: string, v: unknown) {
      this.filters.push((r) => r[col] !== v);
      return this;
    }
    in(col: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[col]));
      return this;
    }
    is(col: string, v: unknown) {
      this.filters.push((r) => (r[col] ?? null) === v);
      return this;
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.orderBy.push({ col, asc: o?.ascending !== false });
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    single() {
      this.one = "single";
      return this;
    }
    maybeSingle() {
      this.one = "maybe";
      return this;
    }

    private run(): Result {
      const rows = table(this.t);
      let hit: Record<string, unknown>[];
      let returned = true;
      if (this.mode === "insert") {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
        hit = incoming.map((r) => ({ id: randomUUID(), created_at: now(), updated_at: now(), ...copy(r) }));
        rows.push(...hit);
        returned = this.returning;
      } else {
        hit = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.mode === "update") {
          for (const r of hit) Object.assign(r, copy(this.payload as object), { updated_at: now() });
          returned = this.returning;
        } else if (this.mode === "delete") {
          tables[this.t] = rows.filter((r) => !hit.includes(r));
          returned = false;
        }
      }
      if (this.mode === "select" || returned) {
        hit = [...hit];
        for (const { col, asc } of [...this.orderBy].reverse()) {
          hit.sort((a, b) => {
            const x = a[col] as string | number, y = b[col] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
          });
        }
        if (this.max !== null) hit = hit.slice(0, this.max);
      }
      if (!returned) return { data: null, error: null };
      const out = copy(hit);
      if (this.one === "single") {
        if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: `expected 1 row, got ${out.length}` } };
        return { data: out[0], error: null };
      }
      if (this.one === "maybe") {
        if (out.length > 1) return { data: null, error: { code: "PGRST116", message: `expected <= 1 row, got ${out.length}` } };
        return { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    }

    then<A = Result, B = never>(
      onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
    }
  }

  const client = {
    tables,
    rpcCalls,
    from: (t: string) => new Query(t),
    rpc: async (fn: string, args: Record<string, unknown> = {}): Promise<Result> => {
      rpcCalls.push({ fn, args });
      const h = opts.rpc?.[fn] ?? builtinRpc[fn];
      if (!h) return { data: null, error: { message: `fakeDb: unsupported rpc ${fn}` } };
      try {
        return { data: await h(args, client as unknown as FakeDb), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  };
  // `tables` is reassigned on delete; expose a live view.
  Object.defineProperty(client, "tables", { get: () => tables });
  return client as unknown as FakeDb;
}

// ---------- Row factories (handy for any agent's tests) ----------

import { DEFAULT_AUTOPILOT, SETTINGS_ID } from "../db/types";
import type { Approval, Customer, Job, Settings } from "../db/types";

const T0 = "2026-01-01T00:00:00.000Z";

export function settingsRow(over: Partial<Settings> = {}): Settings {
  return {
    id: SETTINGS_ID, created_at: T0, updated_at: T0,
    ai_monthly_cap: null, default_wage: 15, margin: 0.5, min_job_price: null,
    card_fee_pct: 0.029, card_fee_fixed: 0.3, drop_notice_hours: 24,
    autopilot: structuredClone(DEFAULT_AUTOPILOT), quote_valid_days: 14,
    base_lat: null, base_lng: null, partner_tree_service_name: null, partner_tree_service_email: null,
    ...over,
  };
}

export function approvalRow(over: Partial<Approval> = {}): Approval {
  return {
    id: randomUUID(), created_at: T0, updated_at: T0, kind: "ad", ref_table: "ads", ref_id: randomUUID(),
    payload: {}, status: "pending", created_by: "test", decided_at: null, decided_by: null,
    decision_note: null, title: "Test", summary: null, ...over,
  };
}

export function customerRow(over: Partial<Customer> = {}): Customer {
  return {
    id: randomUUID(), created_at: T0, updated_at: T0, name: "Test Customer", email: null, phone: null,
    address: null, lat: null, lng: null, parcel_id: null, lot_acres: null, tree_cover: null,
    email_opt_in: false, sms_opt_in: false, snow_list: false, notes: null, unsubscribe_token: randomUUID(),
    ...over,
  };
}

export function jobRow(over: Partial<Job> = {}): Job {
  return {
    id: randomUUID(), created_at: T0, updated_at: T0, quote_id: null, customer_id: randomUUID(),
    status: "unscheduled", start_at: null, end_at: null, est_minutes: 60, crew_size: 1, paid: true,
    weather_hold: false, paid_at: T0, deadline: null, schedule_reason: null, resolve_reason: null, owner_hold: false,
    weather_hold_date: null, actual_minutes: null,
    started_at: null, completed_at: null, completion_photo_paths: [], notes: null, ...over,
  };
}
