/** `send_message` (role followup): deliver one approved message through lib/email. */
import { sendMessage } from "../../lib/email";
import type { TaskContext } from "../context";
import type { SendMessagePayload } from "./schemas";

export async function runSendMessage(ctx: TaskContext, payload: SendMessagePayload): Promise<Record<string, unknown>> {
  const result = await sendMessage(ctx.db, payload.message_id, { siteUrl: ctx.siteUrl });
  // Delivery failures retry with backoff; "cancelled" (no opt-in / no address) is a final answer.
  if (result.status === "failed") throw new Error(`send failed: ${result.error}`);
  return { message_id: payload.message_id, ...result };
}
