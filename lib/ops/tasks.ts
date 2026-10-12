import type { FleetRole, FleetTaskPayload, FleetTaskType } from "../db/types";
import { check } from "./types";
import type { Db } from "./types";

/** Which fleet role handles a task type, so callers can omit `role`. */
export function taskRoleFor(type: FleetTaskType): FleetRole {
  switch (type) {
    case "quote":
    case "custom_summary":
      return "quotes";
    case "schedule":
      return "scheduler";
    case "ad_draft":
      return "ads";
    case "followup_review":
    case "followup_reminder":
    case "weather_watch":
    case "send_message":
      return "followup";
    default: {
      const never: never = type;
      throw new Error(`taskRoleFor: unknown task type ${String(never)}`);
    }
  }
}

export type EnqueueTaskInput = {
  type: FleetTaskType;
  /** Defaults to `taskRoleFor(type)`. */
  role?: FleetRole;
  payload: FleetTaskPayload;
  /** ISO timestamp; default now. */
  runAfter?: string;
  /** Idempotency key; a second enqueue with the same key is a no-op in the RPC. */
  dedupeKey?: string;
};

/** Enqueues a fleet task through the `enqueue_task` RPC and returns its id. */
export async function enqueueTask(db: Db, input: EnqueueTaskInput): Promise<string> {
  const args: {
    p_type: FleetTaskType;
    p_role: FleetRole;
    p_payload: FleetTaskPayload;
    p_run_after?: string;
    p_dedupe_key?: string;
  } = {
    p_type: input.type,
    p_role: input.role ?? taskRoleFor(input.type),
    p_payload: input.payload,
  };
  if (input.runAfter !== undefined) args.p_run_after = input.runAfter;
  if (input.dedupeKey !== undefined) args.p_dedupe_key = input.dedupeKey;
  return check(await db.rpc("enqueue_task", args), `enqueueTask(${input.type})`) as string;
}

const BUCKET_MS = 15 * 60 * 1000;

/** `schedule:<n>` where n is the 15-minute bucket since epoch. */
export function scheduleDedupeKey(now: Date = new Date()): string {
  return `schedule:${Math.floor(now.getTime() / BUCKET_MS)}`;
}

/** 8-hex-digit FNV-1a hash (stable, dependency-free; only used to keep dedupe keys short). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Dedupe key for a schedule task. A plain sweep (no job ids) shares the 15-minute bucket key, so
 * the host and the scheduler's own timer don't stack sweeps. An event-driven enqueue for specific
 * jobs gets its own key (`schedule:<bucket>:<reason>:<hash of sorted ids>`), so it never collapses
 * into a sweep (or an earlier, finished task) and silently loses its ids.
 */
export function scheduleTaskKey(reason: string, jobIds?: string[], now: Date = new Date()): string {
  const bucket = scheduleDedupeKey(now);
  if (!jobIds || !jobIds.length) return bucket;
  const ids = Array.from(new Set(jobIds)).sort().join(",");
  const tag = reason.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "event";
  return `${bucket}:${tag}:${shortHash(ids)}`;
}

/**
 * Asks the scheduler to (re-)solve. The ids are only a hint: what the scheduler re-looks at is
 * durable state on the job rows (`jobs.resolve_reason`, see `markForResolve` in ./jobs, plus every
 * `unscheduled` job), so a de-duped or late task never loses work. See `scheduleTaskKey` for keys.
 */
export async function enqueueSchedule(
  db: Db,
  reason: string,
  jobIds?: string[],
  now: Date = new Date(),
): Promise<string> {
  return enqueueTask(db, {
    type: "schedule",
    payload: { reason, ...(jobIds && jobIds.length ? { job_ids: jobIds } : {}) },
    dedupeKey: scheduleTaskKey(reason, jobIds, now),
  });
}
