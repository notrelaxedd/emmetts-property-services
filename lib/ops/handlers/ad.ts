import type { ApprovalHandler } from "../approvals";

/**
 * Side effect that runs when an approval of kind "ad" is approved or edited.
 * TODO: implemented by the phase that owns this kind (see docs/PLAN.md).
 */
export const adHandler: ApprovalHandler = async (_db, approval, _ctx) => {
  console.warn(`[approvals] no side effect implemented yet for kind "ad" (${approval.id})`);
};
