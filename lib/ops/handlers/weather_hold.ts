import type { ApprovalHandler } from "../approvals";
import { holdForWeather } from "../jobs";

/**
 * Side effect for an approved "weather_hold" approval (the followup worker's rain/snow watch):
 * put the listed jobs on hold and mark them for re-planning (`resolve_reason = 'weather_hold'`);
 * the scheduler takes each off its day, keeps that day closed for it, and proposes a new slot.
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
  await holdForWeather(db, jobIds);
};
