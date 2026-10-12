import type { ApprovalHandler } from "../approvals";

/**
 * Side effect that runs when an approval of kind "drop" is approved or edited.
 * TODO: implemented by the phase that owns this kind (see docs/PLAN.md).
 */
export const dropHandler: ApprovalHandler = async (_db, approval, _ctx) => {
  console.warn(`[approvals] no side effect implemented yet for kind "drop" (${approval.id})`);
};
