import type { ApprovalHandler } from "../approvals";
import { enqueueSchedule } from "../tasks";
import { check } from "../types";

/**
 * Side effect for an approved "weather_hold" approval (the followup worker's rain/snow watch):
 * put the listed jobs on hold and ask the scheduler to re-solve them.
 * Payload: `{ job_ids: string[] }` (ref_table "jobs" / ref_id is used when job_ids is missing).
 */
export const weather_holdHandler: ApprovalHandler = async (db, approval, _ctx) => {
  const fromPayload = Array.isArray(approval.payload.job_ids)
    ? approval.payload.job_ids.filter((j): j is string => typeof j === "string")
    : [];
  const jobIds = fromPayload.length ? fromPayload : approval.ref_table === "jobs" ? [approval.ref_id] : [];
  if (!jobIds.length) {
    console.warn(`[approvals] weather_hold approval ${approval.id} has no job_ids; nothing to hold`);
    return;
  }
  check(await db.from("jobs").update({ weather_hold: true }).in("id", jobIds), "weather_holdHandler(hold)");
  await enqueueSchedule(db, "weather_hold", jobIds);
};
