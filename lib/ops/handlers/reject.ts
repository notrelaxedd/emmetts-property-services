import type { ApprovalHandler } from "../approvals";
import { isInfoBookingPayload, tryTransitionJob } from "../jobs";
import { check } from "../types";

/**
 * What happens when the owner REJECTS an approval card. Approvals are "may I?" questions; most
 * rejections simply mean "no, leave it", but a few need to undo a provisional state.
 */

/** Crew wanted to drop inside the notice window → they stay on the job. */
export const rejectDrop: ApprovalHandler = async (db, approval) => {
  const assignmentId = String(approval.payload.assignment_id ?? approval.ref_id);
  check(
    await db
      .from("job_assignments")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", assignmentId)
      .eq("status", "drop_requested"),
    "rejectDrop",
  );
};

/** Time-off request declined. */
export const rejectCrewChange: ApprovalHandler = async (db, approval) => {
  const id = String(approval.payload.crew_exception_id ?? approval.ref_id);
  check(await db.from("crew_exceptions").update({ status: "declined" }).eq("id", id).eq("status", "pending"), "rejectCrewChange");
};

/** Owner doesn't want this quote sent: quote declined, lead lost. */
export const rejectQuote: ApprovalHandler = async (db, approval) => {
  const quoteId = String(approval.payload.quote_id ?? approval.ref_id);
  const quote = check(await db.from("quotes").select("id,lead_id,status,paid_at").eq("id", quoteId).maybeSingle(), "rejectQuote(quote)");
  // A quote the customer confirmed by phone, or paid, is not declined by rejecting a card about it.
  if (!quote || quote.status === "accepted" || quote.paid_at) return;
  check(await db.from("quotes").update({ status: "declined" }).eq("id", quoteId), "rejectQuote(update)");
  check(await db.from("leads").update({ status: "lost" }).eq("id", quote.lead_id), "rejectQuote(lead)");
};

/**
 * Proposed booking rejected: free the crew, put the job back in the unscheduled pile and put it on
 * `owner_hold`, so the next sweep doesn't propose the same slot again. The owner releases it from
 * the Schedule page. The scheduler's informational cards ("Can't schedule X", "No cover for X")
 * are a no-op here: "Mark handled" on those is handled by the inbox action (owner hold only).
 */
export const rejectBooking: ApprovalHandler = async (db, approval, ctx) => {
  if (isInfoBookingPayload(approval.payload)) return;
  const jobId = String(approval.payload.job_id ?? approval.ref_id);
  const job = check(await db.from("jobs").select("id,status").eq("id", jobId).maybeSingle(), "rejectBooking(job)");
  if (!job || !["proposed", "crew_confirmed"].includes(job.status)) return;
  const moved = await tryTransitionJob(db, jobId, "unscheduled", {
    actor: ctx.actor,
    from: ["proposed", "crew_confirmed"],
    patch: {
      owner_hold: true,
      resolve_reason: null,
      schedule_reason: "Owner rejected the proposed time. Release it on the Schedule page to re-plan.",
    },
  });
  if (!moved) return;
  check(
    await db
      .from("job_assignments")
      .update({ status: "dropped" })
      .eq("job_id", jobId)
      .in("status", ["offered", "accepted", "drop_requested"]),
    "rejectBooking(assignments)",
  );
  check(
    await db.from("job_assignments").delete().eq("job_id", jobId).eq("status", "swap_offered"),
    "rejectBooking(swaps)",
  );
};

/** Drafted message not wanted. */
export const rejectFollowup: ApprovalHandler = async (db, approval) => {
  const ids = Array.isArray(approval.payload.message_ids)
    ? (approval.payload.message_ids as string[])
    : [String(approval.payload.message_id ?? approval.ref_id)];
  check(await db.from("messages").update({ status: "cancelled" }).in("id", ids).neq("status", "sent"), "rejectFollowup");
};

/** Ad draft binned. */
export const rejectAd: ApprovalHandler = async (db, approval) => {
  const adId = String(approval.payload.ad_id ?? approval.ref_id);
  check(await db.from("ads").delete().eq("id", adId).eq("status", "draft"), "rejectAd");
};
