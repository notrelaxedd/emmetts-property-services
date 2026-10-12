import type { ApprovalHandler } from "../approvals";
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
  const quote = check(await db.from("quotes").select("id,lead_id,status").eq("id", quoteId).maybeSingle(), "rejectQuote(quote)");
  if (!quote || quote.status === "accepted") return;
  check(await db.from("quotes").update({ status: "declined" }).eq("id", quoteId), "rejectQuote(update)");
  check(await db.from("leads").update({ status: "lost" }).eq("id", quote.lead_id), "rejectQuote(lead)");
};

/** Proposed booking rejected: free the crew and put the job back in the unscheduled pile. */
export const rejectBooking: ApprovalHandler = async (db, approval) => {
  const jobId = String(approval.payload.job_id ?? approval.ref_id);
  const job = check(await db.from("jobs").select("id,status").eq("id", jobId).maybeSingle(), "rejectBooking(job)");
  if (!job || !["proposed", "crew_confirmed"].includes(job.status)) return;
  check(
    await db.from("job_assignments").update({ status: "dropped" }).eq("job_id", jobId).in("status", ["offered", "accepted", "swap_offered"]),
    "rejectBooking(assignments)",
  );
  check(
    await db
      .from("jobs")
      .update({ status: "unscheduled", start_at: null, end_at: null, schedule_reason: "Owner rejected the proposed time; move it on the schedule." })
      .eq("id", jobId),
    "rejectBooking(job)",
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
