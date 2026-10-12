/** `followup_reminder` (role followup): day-before reminder for a booked job → `followup` approval. */
import type { MessageChannel } from "../../lib/db/types";
import { formatDayLabel, formatTimeRange } from "../../lib/scheduler/time";
import type { TaskContext } from "../context";
import { getById } from "../db";
import { PermanentTaskError } from "../errors";
import { firstName, reminderTemplate } from "../templates";
import { draftMessageAndApproval, draftOr, existingJobMessage, jobServices } from "./followup_common";
import type { FollowupReminderPayload } from "./schemas";

export async function runFollowupReminder(ctx: TaskContext, payload: FollowupReminderPayload): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const job = await getById(db, "jobs", payload.job_id);
  if (!job) throw new PermanentTaskError(`job ${payload.job_id} not found`);
  if (job.status !== "booked") return { skipped: `job is ${job.status}` };
  if (!job.start_at || !job.end_at) return { skipped: "job has no time" };
  if (Date.parse(job.start_at) <= ctx.now().getTime()) return { skipped: "job already started" };
  const customer = await getById(db, "customers", job.customer_id);
  if (!customer) throw new PermanentTaskError(`customer ${job.customer_id} not found`);

  // Reminders are transactional (no opt-in needed for email); texts still need sms_opt_in.
  const channel: MessageChannel | null = customer.email ? "email" : customer.phone && customer.sms_opt_in ? "sms" : null;
  if (!channel) return { skipped: "no email and no SMS opt-in" };

  const existing = await existingJobMessage(db, job.id, "reminder");
  if (existing && existing.status !== "draft") return { skipped: `reminder already ${existing.status}`, message_id: existing.id };

  const start = new Date(job.start_at);
  const when = `on ${formatDayLabel(start)}, ${formatTimeRange(start, new Date(job.end_at))}`;
  const services = await jobServices(db, job);
  const draft = await draftOr(
    ctx,
    () =>
      ctx.ai.draftMessage(db, {
        kind: "reminder",
        customer: { name: customer.name, first_name: firstName(customer.name) },
        job: { services, start_at: when, address: customer.address ?? undefined },
        ...(channel === "sms" ? { extra: { channel: "sms: keep it under 300 characters, no subject needed" } } : {}),
      }),
    reminderTemplate({ name: customer.name, when, services, address: customer.address }),
  );
  return draftMessageAndApproval(ctx, {
    customer, job, kind: "reminder", channel, draft, title: `Reminder: ${customer.name} ${when}`, reuse: existing,
  });
}
