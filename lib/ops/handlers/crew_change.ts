import type { ApprovalHandler } from "../approvals";
import { enqueueSchedule } from "../tasks";
import { check } from "../types";

/**
 * Side effect for an approved "crew_change" approval (time off that hits a booked job or is inside
 * the notice window): mark the `crew_exceptions` row approved and ask the scheduler to re-solve.
 * Payload: `{ crew_exception_id, job_ids? }` (ref_table "crew_exceptions" / ref_id also works).
 * A rejected approval runs no handler; the inbox should set the exception to `declined` itself.
 */
export const crew_changeHandler: ApprovalHandler = async (db, approval, _ctx) => {
  const exceptionId =
    typeof approval.payload.crew_exception_id === "string"
      ? approval.payload.crew_exception_id
      : approval.ref_table === "crew_exceptions"
        ? approval.ref_id
        : null;
  if (!exceptionId) throw new Error(`crew_changeHandler: approval ${approval.id} has no crew_exception_id`);

  const row = check(
    await db.from("crew_exceptions").update({ status: "approved" }).eq("id", exceptionId).select("id"),
    "crew_changeHandler(approve)",
  );
  if (!row || row.length === 0) throw new Error(`crew_changeHandler: crew exception ${exceptionId} not found`);

  const jobIds = Array.isArray(approval.payload.job_ids)
    ? approval.payload.job_ids.filter((j): j is string => typeof j === "string")
    : undefined;
  await enqueueSchedule(db, "crew_change_approved", jobIds);
};
