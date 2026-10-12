import type { ApprovalHandler } from "../approvals";
import { enqueueSchedule } from "../tasks";
import { check } from "../types";

/**
 * Side effect for an approved "drop" approval (a crew member dropping a booked job inside the
 * notice window): the assignment becomes `dropped`, a `booked` / `crew_confirmed` job goes back to
 * `proposed` (so it needs re-confirming once cover is found), and the scheduler is asked to find cover.
 * Payload: `{ assignment_id, job_id }`.
 */
export const dropHandler: ApprovalHandler = async (db, approval, _ctx) => {
  const assignmentId =
    typeof approval.payload.assignment_id === "string"
      ? approval.payload.assignment_id
      : approval.ref_table === "job_assignments"
        ? approval.ref_id
        : null;
  if (!assignmentId) throw new Error(`dropHandler: approval ${approval.id} has no assignment_id`);

  const assignment = check(
    await db.from("job_assignments").select("*").eq("id", assignmentId).maybeSingle(),
    "dropHandler(assignment)",
  );
  if (!assignment) throw new Error(`dropHandler: assignment ${assignmentId} not found`);
  const jobId = typeof approval.payload.job_id === "string" ? approval.payload.job_id : assignment.job_id;

  if (assignment.status !== "dropped") {
    check(
      await db
        .from("job_assignments")
        .update({ status: "dropped", responded_at: new Date().toISOString() })
        .eq("id", assignmentId),
      "dropHandler(drop)",
    );
  }

  // booked/crew_confirmed -> proposed is a re-confirm, not a normal forward move, so it is written
  // directly (JOB_TRANSITIONS only allows crew_confirmed -> unscheduled, which would lose the slot).
  check(
    await db.from("jobs").update({ status: "proposed" }).eq("id", jobId).in("status", ["booked", "crew_confirmed"]),
    "dropHandler(job)",
  );

  await enqueueSchedule(db, "drop_approved", [jobId]);
};
