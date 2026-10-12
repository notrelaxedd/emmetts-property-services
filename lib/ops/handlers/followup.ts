import type { Message } from "../../db/types";
import { sendMessage } from "../../email";
import type { ApprovalHandler } from "../approvals";
import { check } from "../types";
import type { Db } from "../types";

/** Message kinds that talk about a specific booked visit and go stale when the job moves or ends. */
const JOB_BOUND_KINDS = new Set<Message["kind"]>(["reminder", "confirmation"]);

/**
 * Why a reminder / confirmation must not go out any more, or null when it's still good to send:
 * the job is gone, no longer `booked` (cancelled, rescheduled back to proposed, already started /
 * done), or its start time has passed.
 */
export async function staleJobMessageReason(db: Db, message: Pick<Message, "job_id" | "kind">, now: Date = new Date()): Promise<string | null> {
  if (!message.job_id || !JOB_BOUND_KINDS.has(message.kind)) return null;
  const job = check(await db.from("jobs").select("id,status,start_at").eq("id", message.job_id).maybeSingle(), "followupHandler(job)");
  if (!job) return "not sent: the job no longer exists";
  if (job.status !== "booked") return `not sent: the job is ${job.status}, not booked`;
  if (!job.start_at) return "not sent: the job has no start time";
  if (Date.parse(job.start_at) <= now.getTime()) return `not sent: the job's start time (${job.start_at}) has passed`;
  return null;
}

/**
 * Side effect for an approved / edited "followup" approval: send the drafted message(s).
 * Payload: `{ message_id }` or `{ message_ids: string[] }` (one snow-plan email to many customers),
 * plus optional `subject` / `body` edits the owner made on the card, which are written to every
 * message row first. A message the email layer cancels (customer unsubscribed / not opted in) is not
 * an error; a delivery failure on any message is, after the others have been attempted.
 * A reminder / confirmation whose job is no longer booked, or already started, is cancelled (with the
 * reason in `error`) instead of being sent: the card may have sat in the inbox while the job changed.
 */
export const followupHandler: ApprovalHandler = async (db, approval, ctx) => {
  const ids: string[] = Array.isArray(approval.payload.message_ids)
    ? (approval.payload.message_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : typeof approval.payload.message_id === "string"
      ? [approval.payload.message_id]
      : approval.ref_table === "messages"
        ? [approval.ref_id]
        : [];
  if (ids.length === 0) throw new Error(`followupHandler: approval ${approval.id} has no message_id(s)`);

  const edits: { subject?: string; body?: string } = {};
  if (typeof approval.payload.subject === "string") edits.subject = approval.payload.subject;
  if (typeof approval.payload.body === "string") edits.body = approval.payload.body;

  const failures: string[] = [];
  for (const messageId of ids) {
    const message = check(await db.from("messages").select("*").eq("id", messageId).maybeSingle(), "followupHandler(message)");
    if (!message) {
      failures.push(`${messageId}: not found`);
      continue;
    }
    if (message.status === "sent") continue; // already delivered (retry)

    const stale = await staleJobMessageReason(db, message);
    if (stale) {
      check(await db.from("messages").update({ status: "cancelled", error: stale }).eq("id", messageId), "followupHandler(stale)");
      console.warn(`[approvals] followup message ${messageId} ${stale}`);
      continue;
    }

    check(await db.from("messages").update({ ...edits, status: "queued", error: null }).eq("id", messageId), "followupHandler(update)");

    const result = await sendMessage(db, messageId, { siteUrl: ctx.siteUrl });
    if (result.status === "failed") failures.push(`${messageId}: ${result.error}`);
    if (result.status === "cancelled") console.warn(`[approvals] followup message ${messageId} not sent: ${result.error}`);
  }
  if (failures.length) throw new Error(`followupHandler: ${failures.length}/${ids.length} message(s) failed to send: ${failures.join("; ")}`);
};
