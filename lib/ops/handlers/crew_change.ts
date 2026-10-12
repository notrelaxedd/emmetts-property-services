import type { ApprovalHandler } from "../approvals";
import { applyApprovedCrewException } from "../jobs";
import { check } from "../types";

/**
 * Side effect for an approved "crew_change" approval (time off that hits a booked job or is inside
 * the notice window): mark the `crew_exceptions` row approved, take the crew member off every job
 * that overlaps it (their assignments → `dropped`; the jobs keep their slots and are marked for
 * cover, see `dropCrewFromOverlappingJobs`) and ask the scheduler to re-solve.
 * Payload: `{ crew_exception_id }` (ref_table "crew_exceptions" / ref_id also works).
 * A rejected approval runs `rejectCrewChange` instead (the exception becomes `declined`).
 */
export const crew_changeHandler: ApprovalHandler = async (db, approval, ctx) => {
  const exceptionId =
    typeof approval.payload.crew_exception_id === "string"
      ? approval.payload.crew_exception_id
      : approval.ref_table === "crew_exceptions"
        ? approval.ref_id
        : null;
  if (!exceptionId) throw new Error(`crew_changeHandler: approval ${approval.id} has no crew_exception_id`);

  const rows = check(
    await db.from("crew_exceptions").update({ status: "approved" }).eq("id", exceptionId).select("*"),
    "crew_changeHandler(approve)",
  );
  const exception = rows?.[0];
  if (!exception) throw new Error(`crew_changeHandler: crew exception ${exceptionId} not found`);

  await applyApprovedCrewException(db, exception, { actor: ctx.actor });
};
