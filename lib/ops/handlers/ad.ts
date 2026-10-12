import type { ApprovalHandler } from "../approvals";
import { check } from "../types";

/**
 * Side effect for an approved / edited "ad" approval. v1 does not post anywhere: the ad is marked
 * `approved` and the admin shows the copy with an "Open Ads Manager / Nextdoor" button.
 * Payload: `{ ad_id, channel, headline, body, cta }`; owner edits to headline / body / cta are
 * written back to the ad row.
 */
export const adHandler: ApprovalHandler = async (db, approval, _ctx) => {
  const p = approval.payload;
  const adId = typeof p.ad_id === "string" ? p.ad_id : approval.ref_table === "ads" ? approval.ref_id : null;
  if (!adId) throw new Error(`adHandler: approval ${approval.id} has no ad_id`);
  const ad = check(await db.from("ads").select("*").eq("id", adId).maybeSingle(), "adHandler(ad)");
  if (!ad) throw new Error(`adHandler: ad ${adId} not found`);
  if (ad.status === "posted") return;

  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const patch: { status: "approved"; headline?: string; body?: string; cta?: string } = { status: "approved" };
  const headline = text(p.headline);
  const body = text(p.body);
  const cta = text(p.cta);
  if (headline) patch.headline = headline;
  if (body) patch.body = body;
  if (cta) patch.cta = cta;
  check(await db.from("ads").update(patch).eq("id", adId), "adHandler(update)");
};
