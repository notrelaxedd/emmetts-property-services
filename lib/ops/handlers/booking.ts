import { draftMessage } from "../../ai/claude";
import type { Customer, Job, Message } from "../../db/types";
import { sendMessage } from "../../email";
import { formatDayLabel, formatTimeRange } from "../../scheduler/time";
import { siteConfig } from "../../site-config";
import type { ApprovalHandler } from "../approvals";
import { transitionJob } from "../jobs";
import { enqueueTask } from "../tasks";
import { check, one } from "../types";
import type { Db } from "../types";

const DAY_MS = 86_400_000;

function jobIdOf(approval: { ref_table: string; ref_id: string; payload: Record<string, unknown> }): string {
  if (typeof approval.payload.job_id === "string") return approval.payload.job_id;
  if (approval.ref_table === "jobs") return approval.ref_id;
  throw new Error("bookingHandler: approval has no job_id");
}

/** "Tue Oct 14, 9:00–10:30am" (business timezone), or "a time we'll confirm" if unscheduled. */
export function describeSlot(job: Pick<Job, "start_at" | "end_at">): string {
  if (!job.start_at) return "a time we'll confirm with you";
  const start = new Date(job.start_at);
  const end = job.end_at ? new Date(job.end_at) : start;
  return `${formatDayLabel(start)}, ${formatTimeRange(start, end)}`;
}

/** Plain-text confirmation used when the AI draft fails or the AI budget cap is hit. */
export function fallbackConfirmationEmail(input: {
  firstName: string;
  services: string[];
  when: string;
  address: string | null;
}): { subject: string; body: string } {
  const what = input.services.length ? input.services.join(", ") : "your service";
  const body = [
    `Hi ${input.firstName},`,
    "",
    `You're booked! Our crew will be there for ${what} on ${input.when}${input.address ? ` at ${input.address}` : ""}.`,
    "",
    "We'll send a reminder the day before. If the weather turns, we'll reach out to reschedule.",
    "",
    `Questions or need to change something? Call or text us at ${siteConfig.phone.display}.`,
    "",
    "Thanks,",
    siteConfig.name,
  ].join("\n");
  return { subject: `You're booked: ${input.when}`, body };
}

async function jobServices(db: Db, job: Job): Promise<string[]> {
  if (!job.quote_id) return [];
  const items = check(
    await db.from("quote_items").select("*").eq("quote_id", job.quote_id).in("status", ["auto", "priced"]),
    "bookingHandler(items)",
  );
  return (items ?? []).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.description);
}

async function draftConfirmation(
  db: Db,
  customer: Customer,
  services: string[],
  job: Job,
): Promise<{ subject: string; body: string }> {
  const firstName = customer.name.trim().split(/\s+/)[0] || customer.name;
  const when = describeSlot(job);
  try {
    const draft = await draftMessage(db, {
      kind: "confirmation",
      customer: { name: customer.name, first_name: firstName },
      job: { services, start_at: when, address: customer.address ?? undefined },
    });
    return { subject: draft.subject, body: draft.body };
  } catch (e) {
    console.warn("[approvals] AI confirmation draft failed, using the plain-text template:", e instanceof Error ? e.message : e);
    return fallbackConfirmationEmail({ firstName, services, when, address: customer.address });
  }
}

/** (Re)enqueue the day-before reminder. Skipped when the job starts within 24h (the confirmation covers it). */
async function enqueueReminder(db: Db, job: Job): Promise<void> {
  if (!job.start_at) return;
  const runAfter = Date.parse(job.start_at) - DAY_MS;
  if (!(runAfter > Date.now())) return;
  const dedupeKey = `reminder:${job.id}`;
  // The dedupe key is unique across every status, so clear an old (finished or not-yet-run) reminder
  // from an earlier booking of this job; otherwise the new one would silently be a no-op.
  check(
    await db.from("fleet_tasks").delete().eq("dedupe_key", dedupeKey).in("status", ["queued", "done", "failed"]),
    "bookingHandler(clear old reminder)",
  );
  await enqueueTask(db, {
    type: "followup_reminder",
    payload: { job_id: job.id },
    runAfter: new Date(runAfter).toISOString(),
    dedupeKey,
  });
}

/**
 * Side effect for an approved "booking" approval (all assigned crew accepted → owner OK):
 * job `crew_confirmed` → `booked`, send the customer a confirmation, and enqueue the
 * day-before reminder (`followup_reminder`, dedupe `reminder:<job_id>`).
 * Payload: `{ job_id }` (ref_table "jobs" / ref_id = job id also works). Idempotent on re-run.
 */
export const bookingHandler: ApprovalHandler = async (db, approval, ctx) => {
  const jobId = jobIdOf(approval);
  let job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "bookingHandler(job)");
  if (!job) throw new Error(`bookingHandler: job ${jobId} not found`);

  if (job.status !== "booked") {
    job = await transitionJob(db, jobId, "booked", { actor: ctx.actor });
  }

  const customer = check(
    await db.from("customers").select("*").eq("id", job.customer_id).maybeSingle(),
    "bookingHandler(customer)",
  );
  if (!customer) throw new Error(`bookingHandler: customer ${job.customer_id} not found`);

  // One confirmation per booking: reuse an unsent one from a partial failure, skip if already sent.
  const existing = check(
    await db
      .from("messages")
      .select("*")
      .eq("job_id", jobId)
      .eq("kind", "confirmation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "bookingHandler(existing message)",
  );
  const alreadySent = existing?.status === "sent" && existing.sent_at !== null && existing.sent_at >= job.updated_at;

  if (!alreadySent) {
    const services = await jobServices(db, job);
    const draft = await draftConfirmation(db, customer, services, job);
    const channel = customer.email ? "email" : customer.sms_opt_in && customer.phone ? "sms" : "email";
    const fields = {
      customer_id: customer.id,
      job_id: jobId,
      quote_id: job.quote_id,
      channel,
      kind: "confirmation" as const,
      subject: draft.subject,
      body: draft.body,
      status: "queued" as const,
      error: null,
    } satisfies Partial<Message>;
    const message: Message =
      existing && existing.status !== "sent"
        ? one(await db.from("messages").update(fields).eq("id", existing.id).select("*").single(), "bookingHandler(update message)")
        : one(await db.from("messages").insert(fields).select("*").single(), "bookingHandler(insert message)");
    const result = await sendMessage(db, message.id, { siteUrl: ctx.siteUrl });
    if (result.status !== "sent") {
      console.warn(`[approvals] booking confirmation for job ${jobId} not sent (${result.status}: ${result.error})`);
    }
  }

  await enqueueReminder(db, job);
};
