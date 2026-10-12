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

/**
 * Asks the scheduler to (re-)solve. De-duped per 15-minute bucket, so a burst of events yields one
 * task (the scheduler also sweeps all unscheduled jobs every 15 min, so dropped `job_ids` are safe).
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
    dedupeKey: scheduleDedupeKey(now),
  });
}
