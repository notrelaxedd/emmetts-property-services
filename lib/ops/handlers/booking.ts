import type { ApprovalHandler } from "../approvals";
import { bookJob, completeBooking } from "../booking";
import { isCallToConfirmPayload, transitionJob } from "../jobs";
import { isPaymentMethod } from "../payment-methods";
import { check } from "../types";

// Kept here for callers and tests that import them from the handler.
export { describeSlot, fallbackConfirmationEmail } from "../booking";

function jobIdOf(approval: { ref_table: string; ref_id: string; payload: Record<string, unknown> }): string {
  if (typeof approval.payload.job_id === "string") return approval.payload.job_id;
  if (approval.ref_table === "jobs") return approval.ref_id;
  throw new Error("bookingHandler: approval has no job_id");
}

/**
 * Side effect for an approved / edited "booking" approval.
 *
 * The "Call <customer> to confirm" card (`payload.call_to_confirm`): the owner confirmed the quote and
 * the day on the phone. The edit carries `payment_method` (cash / check / stripe = card link after the
 * job) and `crew_ids` (who to put on it); `bookJob` does the rest (crew, quote accepted, confirmation
 * email, reminder).
 *
 * Legacy "Book" card (`{ job_id }`, scheduler-era): job `crew_confirmed` → `booked`, confirmation +
 * reminder. The scheduler's informational cards are a no-op.
 */
export const bookingHandler: ApprovalHandler = async (db, approval, ctx) => {
  if (approval.payload.unschedulable === true || approval.payload.needs_cover === true) return;
  const jobId = jobIdOf(approval);

  if (isCallToConfirmPayload(approval.payload)) {
    const method = approval.payload.payment_method;
    if (!isPaymentMethod(method)) {
      throw new Error("Pick how the customer will pay (cash, check or card) before booking. Use the schedule page if the card has no edit controls.");
    }
    const crewIds = Array.isArray(approval.payload.crew_ids)
      ? approval.payload.crew_ids.filter((x): x is string => typeof x === "string")
      : (check(await db.from("job_assignments").select("*").eq("job_id", jobId).eq("status", "accepted"), "bookingHandler(accepted)") ?? []).map((a) => a.crew_id);
    const note = typeof approval.decision_note === "string" ? approval.decision_note : null;
    await bookJob(db, jobId, { paymentMethod: method, crewIds, actor: ctx.actor, siteUrl: ctx.siteUrl, note });
    return;
  }

  let job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "bookingHandler(job)");
  if (!job) throw new Error(`bookingHandler: job ${jobId} not found`);
  if (job.status !== "booked" && job.status !== "crew_confirmed") {
    throw new Error(`This job is ${job.status.replace("_", " ")}, so it can't be booked until every crew member accepts.`);
  }
  if (job.status !== "booked") job = await transitionJob(db, jobId, "booked", { actor: ctx.actor });
  await completeBooking(db, job, ctx);
};
