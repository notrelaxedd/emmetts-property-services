import { sendMessage } from "../../email";
import type { ApprovalHandler } from "../approvals";
import { check } from "../types";

/**
 * Side effect for an approved / edited "followup" approval: send the drafted message(s).
 * Payload: `{ message_id }` or `{ message_ids: string[] }` (one snow-plan email to many customers),
 * plus optional `subject` / `body` edits the owner made on the card, which are written to every
 * message row first. A message the email layer cancels (customer unsubscribed / not opted in) is not
 * an error; a delivery failure on any message is, after the others have been attempted.
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

    check(await db.from("messages").update({ ...edits, status: "queued", error: null }).eq("id", messageId), "followupHandler(update)");

    const result = await sendMessage(db, messageId, { siteUrl: ctx.siteUrl });
    if (result.status === "failed") failures.push(`${messageId}: ${result.error}`);
    if (result.status === "cancelled") console.warn(`[approvals] followup message ${messageId} not sent: ${result.error}`);
  }
  if (failures.length) throw new Error(`followupHandler: ${failures.length}/${ids.length} message(s) failed to send: ${failures.join("; ")}`);
};
