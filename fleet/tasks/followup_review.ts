/** `followup_review` (role followup): review request for a finished job → `followup` approval. */
import type { TaskContext } from "../context";
import { getById } from "../db";
import { PermanentTaskError } from "../errors";
import { firstName, reviewTemplate } from "../templates";
import { draftMessageAndApproval, draftOr, existingJobMessage, jobServices } from "./followup_common";
import type { FollowupReviewPayload } from "./schemas";

export async function runFollowupReview(ctx: TaskContext, payload: FollowupReviewPayload): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const job = await getById(db, "jobs", payload.job_id);
  if (!job) throw new PermanentTaskError(`job ${payload.job_id} not found`);
  if (job.status !== "done") return { skipped: `job is ${job.status}` };
  const customer = await getById(db, "customers", job.customer_id);
  if (!customer) throw new PermanentTaskError(`customer ${job.customer_id} not found`);
  // Review requests are marketing: email only, and only with opt-in.
  if (!customer.email || !customer.email_opt_in) return { skipped: "customer not opted in to email" };

  const existing = await existingJobMessage(db, job.id, "review");
  if (existing && existing.status !== "draft") return { skipped: `review already ${existing.status}`, message_id: existing.id };

  const services = await jobServices(db, job);
  // TODO [REVIEW LINK — ask owner]: set REVIEW_URL (e.g. the Google review link) on the followup box.
  const reviewUrl = process.env.REVIEW_URL?.trim() || null;
  const draft = await draftOr(
    ctx,
    () =>
      ctx.ai.draftMessage(db, {
        kind: "review",
        customer: { name: customer.name, first_name: firstName(customer.name) },
        job: { services, address: customer.address ?? undefined },
        ...(reviewUrl ? { extra: { review_url: reviewUrl } } : {}),
      }),
    reviewTemplate({ name: customer.name, services, reviewUrl }),
  );
  return draftMessageAndApproval(ctx, {
    customer, job, kind: "review", channel: "email", draft, title: `Review request: ${customer.name}`, reuse: existing,
  });
}
