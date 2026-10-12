/** Shared plumbing for the follow-up tasks: AI draft with template fallback, message row, approval. */
import type { Customer, Job, Message, MessageChannel, MessageKind } from "../../lib/db/types";
import { applyApproval, requestApproval } from "../../lib/ops/approvals";
import "../../lib/ops/handlers";
import { check, one } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import type { TaskContext } from "../context";
import { errorMessage } from "../log";

export type Draft = { subject: string; body: string; source: "ai" | "template" };

/** Try the AI draft; on any failure (cap hit, bad output, no key) fall back to the plain template. */
export async function draftOr(
  ctx: TaskContext,
  ai: () => Promise<{ subject: string; body: string }>,
  fallback: { subject: string; body: string },
): Promise<Draft> {
  try {
    const d = await ai();
    return { subject: d.subject, body: d.body, source: "ai" };
  } catch (e) {
    ctx.log.warn("AI draft failed, using template", { err: errorMessage(e) });
    return { ...fallback, source: "template" };
  }
}

/** Descriptions of the billed items on the job's quote (e.g. ["Leaf cleanup", "Edging"]). */
export async function jobServices(db: Db, job: Pick<Job, "quote_id">): Promise<string[]> {
  if (!job.quote_id) return [];
  const items = check(await db.from("quote_items").select("*").eq("quote_id", job.quote_id), "followup(items)") ?? [];
  return items
    .filter((i) => i.status === "auto" || i.status === "priced")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => i.description);
}

/** The latest message of this kind for the job, if any. */
export async function existingJobMessage(db: Db, jobId: string, kind: MessageKind): Promise<Message | null> {
  return check(
    await db.from("messages").select("*").eq("job_id", jobId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "followup(existing message)",
  );
}

/**
 * Write (or rewrite) the draft message, then raise a `followup` approval with payload
 * `{ message_id, kind, subject, body, job_id }`. If autopilot covers follow-ups, send it now; a send
 * failure puts the card back in the inbox instead of failing the task.
 */
export async function draftMessageAndApproval(
  ctx: TaskContext,
  input: {
    customer: Customer;
    job: Job;
    kind: MessageKind;
    channel: MessageChannel;
    draft: Draft;
    title: string;
    reuse: Message | null;
  },
): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const fields = {
    customer_id: input.customer.id, job_id: input.job.id, quote_id: input.job.quote_id, channel: input.channel,
    kind: input.kind, subject: input.channel === "email" ? input.draft.subject : null, body: input.draft.body,
    status: "draft" as const, error: null,
  };
  const message = input.reuse
    ? one(await db.from("messages").update(fields).eq("id", input.reuse.id).select("*").single(), "followup(update message)")
    : one(await db.from("messages").insert(fields).select("*").single(), "followup(insert message)");

  const { approval, autoApproved } = await requestApproval(db, {
    kind: "followup",
    ref_table: "messages",
    ref_id: message.id,
    payload: { message_id: message.id, kind: input.kind, subject: message.subject, body: message.body, job_id: input.job.id },
    title: input.title,
    summary: `${input.channel} to ${input.customer.name}${input.draft.source === "template" ? " (template: AI draft unavailable)" : ""}`,
    created_by: ctx.worker,
  });
  let sent = false;
  if (autoApproved) {
    try {
      sent = await applyApproval(db, approval, { siteUrl: ctx.siteUrl, actor: ctx.worker });
    } catch (e) {
      const note = `autopilot send failed: ${errorMessage(e)}`.slice(0, 500);
      ctx.log.warn("autopilot followup send failed", { message: message.id, err: note });
      check(
        await db.from("approvals").update({ status: "pending", decided_at: null, decided_by: null, decision_note: note }).eq("id", approval.id),
        "followup(revert autopilot)",
      );
    }
  }
  return { message_id: message.id, approval_id: approval.id, auto_sent: sent, draft: input.draft.source };
}
