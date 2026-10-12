import type { ApprovalHandler } from "../approvals";
import { updateSettings } from "../settings";

/**
 * Side effect for an approved "ai_cap" approval ("AI monthly cap reached"). Approving means the
 * owner acknowledged it. If the owner set a new cap while approving (`payload.new_cap`, a number
 * of dollars, or null for no cap), it is saved to `settings.ai_monthly_cap`; otherwise no-op.
 */
export const ai_capHandler: ApprovalHandler = async (db, approval, _ctx) => {
  if (!("new_cap" in approval.payload)) return;
  const raw = approval.payload.new_cap;
  if (raw === null) {
    await updateSettings(db, { ai_monthly_cap: null });
    return;
  }
  const cap = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(cap) || cap < 0) {
    console.warn(`[approvals] ai_cap approval ${approval.id}: ignoring invalid new_cap ${JSON.stringify(raw)}`);
    return;
  }
  await updateSettings(db, { ai_monthly_cap: Math.round(cap * 100) / 100 });
};
