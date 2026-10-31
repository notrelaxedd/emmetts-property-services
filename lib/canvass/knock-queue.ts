/**
 * Pure parts of the knock logger's offline queue (the localStorage glue lives in
 * components/canvass/offline-queue.ts). Every item carries a `client_id` so re-sending after a
 * dropped connection is safe: the server ignores a client_id it has already stored.
 */
import type { HomePattern, KnockOutcome } from "../db/types";

export const KNOCK_QUEUE_KEY = "canvass.knockQueue";
export const MAX_ATTEMPTS = 8;

/** What `logKnockAction` takes; also what sits in the queue. */
export type LogKnockInput = {
  client_id: string;
  parcel_id: string;
  outcome: KnockOutcome;
  /** ISO instant from the phone's clock. */
  knocked_at: string;
  lat: number | null;
  lng: number | null;
  pitch_id: string | null;
  quote_low?: number | null;
  quote_high?: number | null;
  callback_window?: string | null;
  home_pattern?: HomePattern | null;
  notes?: string | null;
};

/** Optional fields the crew can add after the tap (merged into a queued item, or sent as a details update). */
export type KnockDetailsPatch = {
  callback_window?: string | null;
  home_pattern?: HomePattern | null;
  pitch_id?: string | null;
  notes?: string | null;
  quote_low?: number | null;
  quote_high?: number | null;
};

export type QueuedKnock = {
  input: LogKnockInput;
  /** Failed sends so far. */
  attempts: number;
  /** Epoch ms before which the item is not retried. */
  nextAt: number;
  /** Last error, for the owner's eyes only. */
  lastError: string | null;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parse a stored queue blob; junk entries are dropped so one bad row never blocks the rest. */
export function parseQueue(raw: unknown): QueuedKnock[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: QueuedKnock[] = [];
  for (const item of value) {
    if (!isObject(item) || !isObject(item.input)) continue;
    const input = item.input;
    if (typeof input.client_id !== "string" || typeof input.parcel_id !== "string" || typeof input.outcome !== "string") continue;
    out.push({
      input: input as unknown as LogKnockInput,
      attempts: typeof item.attempts === "number" && Number.isFinite(item.attempts) ? item.attempts : 0,
      nextAt: typeof item.nextAt === "number" && Number.isFinite(item.nextAt) ? item.nextAt : 0,
      lastError: typeof item.lastError === "string" ? item.lastError : null,
    });
  }
  return out;
}

/** Add an item; a second item with the same client_id replaces the first (newer fields win). */
export function enqueue(items: readonly QueuedKnock[], input: LogKnockInput, now = 0): QueuedKnock[] {
  const rest = items.filter((i) => i.input.client_id !== input.client_id);
  return [...rest, { input, attempts: 0, nextAt: now, lastError: null }];
}

/** Remove the item with that client_id (no-op when absent). */
export function dequeue(items: readonly QueuedKnock[], clientId: string): QueuedKnock[] {
  return items.filter((i) => i.input.client_id !== clientId);
}

/** Merge details into a queued item; returns the same array when the item is not queued any more. */
export function patchQueued(items: readonly QueuedKnock[], clientId: string, patch: KnockDetailsPatch): QueuedKnock[] {
  let changed = false;
  const out = items.map((i) => {
    if (i.input.client_id !== clientId) return i;
    changed = true;
    const input: LogKnockInput = { ...i.input };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (input as Record<string, unknown>)[k] = v;
    }
    return { ...i, input };
  });
  return changed ? out : [...items];
}

/**
 * Merge two queues (e.g. memory vs. what another tab wrote): one item per client_id, the one with
 * more attempts wins (it is the more recent copy), ordered by knocked_at.
 */
export function mergeQueues(a: readonly QueuedKnock[], b: readonly QueuedKnock[]): QueuedKnock[] {
  const byId = new Map<string, QueuedKnock>();
  for (const item of [...a, ...b]) {
    const cur = byId.get(item.input.client_id);
    if (!cur || item.attempts > cur.attempts) byId.set(item.input.client_id, item);
  }
  return Array.from(byId.values()).sort((x, y) => x.input.knocked_at.localeCompare(y.input.knocked_at));
}

/** 2 s, 4 s, 8 s ... capped at 2 minutes. */
export function backoffMs(attempts: number): number {
  const n = Math.max(0, Math.min(10, Math.floor(attempts)));
  return Math.min(120_000, 2_000 * 2 ** n);
}

/** Items whose retry time has come, oldest first. */
export function dueItems(items: readonly QueuedKnock[], now: number): QueuedKnock[] {
  return items.filter((i) => i.nextAt <= now).sort((x, y) => x.input.knocked_at.localeCompare(y.input.knocked_at));
}

/**
 * What the queue does with a send result: "sent" dequeues, "drop" dequeues a knock the server refused for good
 * (validation, missing house), "retry" keeps it with backoff (a server / database failure, not the knock's fault).
 */
export function sendDisposition(res: { ok: true } | { ok: false; retryable?: boolean }): "sent" | "drop" | "retry" {
  if (res.ok) return "sent";
  return res.retryable ? "retry" : "drop";
}

/** Record a failed send: bump attempts and push the retry out with backoff. */
export function markFailed(items: readonly QueuedKnock[], clientId: string, error: string | null, now: number): QueuedKnock[] {
  return items.map((i) => {
    if (i.input.client_id !== clientId) return i;
    const attempts = i.attempts + 1;
    return { ...i, attempts, nextAt: now + backoffMs(attempts), lastError: error };
  });
}

/** A fresh client id (crypto.randomUUID where available, else a random fallback of the same shape). */
export function newClientId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${hex()}-${hex()}${hex()}${hex()}`;
}
