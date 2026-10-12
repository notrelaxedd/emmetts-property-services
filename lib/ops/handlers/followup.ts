import { sendMessage } from "../../email";
import type { ApprovalHandler } from "../approvals";
import { check } from "../types";

/**
 * Side effect for an approved / edited "followup" approval: send the drafted message.
 * Payload: `{ message_id, subject?, body? }`. If the owner edited `subject` / `body` in the approval,
 * they are written to the message row first. A message the email layer cancels (customer
 * unsubscribed / not opted in) is not an error; a delivery failure is.
 */
export const followupHandler: ApprovalHandler = async (db, approval, ctx) => {
  const messageId =
    typeof approval.payload.message_id === "string"
      ? approval.payload.message_id
      : approval.ref_table === "messages"
        ? approval.ref_id
        : null;
  if (!messageId) throw new Error(`followupHandler: approval ${approval.id} has no message_id`);

  const edits: { subject?: string; body?: string } = {};
  if (typeof approval.payload.subject === "string") edits.subject = approval.payload.subject;
  if (typeof approval.payload.body === "string") edits.body = approval.payload.body;

  const message = check(await db.from("messages").select("*").eq("id", messageId).maybeSingle(), "followupHandler(message)");
  if (!message) throw new Error(`followupHandler: message ${messageId} not found`);
  if (message.status === "sent") return; // already delivered (retry)

  check(await db.from("messages").update({ ...edits, status: "queued", error: null }).eq("id", messageId), "followupHandler(update)");

  const result = await sendMessage(db, messageId, { siteUrl: ctx.siteUrl });
  if (result.status === "failed") throw new Error(`followupHandler: message ${messageId} failed to send: ${result.error}`);
  if (result.status === "cancelled") console.warn(`[approvals] followup message ${messageId} not sent: ${result.error}`);
};
