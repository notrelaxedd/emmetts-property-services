import type { ApprovalHandler } from "../approvals";
import { dropAssignmentKeepSlot } from "../jobs";
import { check } from "../types";

/**
 * Side effect for an approved "drop" approval (a crew member dropping a job inside the notice
 * window): their assignment becomes `dropped` and the job KEEPS its slot and its other crew. It is
 * marked `resolve_reason = 'drop'` so the scheduler's cover pass offers the gap to someone else.
 * A `booked` job stays booked (the customer was confirmed); a `crew_confirmed` one goes back to
 * `proposed` so the replacement's acceptance re-confirms it. See `releaseCrewFromJob`.
 * Payload: `{ assignment_id, job_id }`.
 */
export const dropHandler: ApprovalHandler = async (db, approval, ctx) => {
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

  // `drop_requested` normally; `accepted` too, so an owner OK still works if the row was reset.
  await dropAssignmentKeepSlot(db, assignment, {
    actor: ctx.actor,
    from: ["drop_requested", "accepted"],
    taskReason: "drop_approved",
  });
};
