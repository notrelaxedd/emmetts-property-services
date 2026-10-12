/**
 * `ad_draft` (role ads): Claude drafts one ad for a channel → `ads` row (draft) → `ad` approval.
 * v1 never posts: an approved ad shows its copy with an "Open Ads Manager / Nextdoor" button.
 *
 * The ads worker also enqueues its own weekly drafts (`enqueueWeeklyAdDrafts`): on startup and from
 * Monday 07:00 ET, one per channel per ISO week (dedupe key `ad_draft:<channel>:<iso week>`).
 */
import { AiCapExceededError } from "../../lib/ai/claude";
import { content } from "../../lib/content";
import type { Ad, AdChannel } from "../../lib/db/types";
import { opsConfig } from "../../lib/config";
import { applyApproval, requestApproval } from "../../lib/ops/approvals";
import "../../lib/ops/handlers";
import { getSettings } from "../../lib/ops/settings";
import { enqueueTask } from "../../lib/ops/tasks";
import { check, one } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import { localDate } from "../../lib/scheduler/time";
import type { TaskContext } from "../context";
import { errorMessage } from "../log";
import { isoWeek, seasonOf, weeklyAdsDue, yyyymmdd } from "../time";
import type { Season } from "../time";
import type { AdDraftPayload } from "./schemas";

export const AD_CHANNELS: AdChannel[] = ["facebook", "instagram", "nextdoor"];

const SEASON_OFFER: Record<Season, string> = {
  spring: "Spring cleanup and weekly mowing",
  summer: "Weekly mowing and edging",
  fall: "Fall leaf cleanup",
  winter: "Snow removal",
};

/** The offer the site is leading with right now (the hero headline), else a seasonal default. */
export function currentOffer(season: Season): string {
  const headline = content.hero.headline.join(" ").replace(/\s+/g, " ").trim();
  return headline || SEASON_OFFER[season];
}

export function adDedupeKey(channel: AdChannel, now: Date): string {
  return `ad_draft:${channel}:${isoWeek(localDate(now))}`;
}

/** Enqueue this week's drafts (one per channel). Safe to call often: de-duped per ISO week. */
export async function enqueueWeeklyAdDrafts(db: Db, now: Date): Promise<number> {
  if (!weeklyAdsDue(now)) return 0;
  const season = seasonOf(now);
  const offer = currentOffer(season);
  for (const channel of AD_CHANNELS) {
    await enqueueTask(db, { type: "ad_draft", payload: { channel, season, offer }, dedupeKey: adDedupeKey(channel, now) });
  }
  return AD_CHANNELS.length;
}

/** `${channel}-${season}-${yyyymmdd}`, suffixed `-2`, `-3`, ... if that code is already used by another ad. */
async function freeUtmCode(db: Db, base: string): Promise<{ code: string; reuse: Ad | null }> {
  for (let n = 1; n < 50; n++) {
    const code = n === 1 ? base : `${base}-${n}`;
    const hit = check(await db.from("ads").select("*").eq("utm_code", code).maybeSingle(), "ad_draft(utm)");
    if (!hit) return { code, reuse: null };
    if (hit.status === "draft") return { code, reuse: hit }; // a retry of this task: reuse the draft row
  }
  throw new Error(`no free utm code for ${base}`);
}

export async function runAdDraft(ctx: TaskContext, payload: AdDraftPayload): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const now = ctx.now();
  const base = `${payload.channel}-${payload.season}-${yyyymmdd(now)}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const { code, reuse } = await freeUtmCode(db, base);

  let draft;
  try {
    draft = await ctx.ai.draftAd(db, { channel: payload.channel, season: payload.season, offer: payload.offer });
  } catch (e) {
    if (e instanceof AiCapExceededError) return { skipped: "ai_cap" };
    throw e;
  }

  const settings = await getSettings(db);
  const center = { lat: settings.base_lat ?? opsConfig.defaultBase.lat, lng: settings.base_lng ?? opsConfig.defaultBase.lng };
  const fields = {
    channel: payload.channel, headline: draft.headline, body: draft.body, cta: draft.cta, season: payload.season,
    offer: payload.offer, utm_code: code, status: "draft" as const,
    // Targeting is a starting point for the owner in Ads Manager; radius etc. are set there.
    targeting: { center },
  };
  const ad: Ad = reuse
    ? one(await db.from("ads").update(fields).eq("id", reuse.id).select("*").single(), "ad_draft(update)")
    : one(await db.from("ads").insert({ ...fields, image_path: null, posted_at: null }).select("*").single(), "ad_draft(insert)");

  const { approval, autoApproved } = await requestApproval(
    db,
    {
      kind: "ad",
      ref_table: "ads",
      ref_id: ad.id,
      payload: { ad_id: ad.id, channel: ad.channel, headline: ad.headline, body: ad.body, cta: ad.cta },
      title: `${ad.channel} ad: ${ad.headline}`,
      summary: `${payload.season} · ${payload.offer} · utm ${ad.utm_code}`,
      created_by: ctx.worker,
    },
    settings,
  );
  let applied = false;
  if (autoApproved) {
    try {
      applied = await applyApproval(db, approval, { siteUrl: ctx.siteUrl, actor: ctx.worker });
    } catch (e) {
      ctx.log.warn("autopilot ad apply failed", { ad: ad.id, err: errorMessage(e) });
    }
  }
  return { ad_id: ad.id, utm_code: ad.utm_code, approval_id: approval.id, auto_approved: applied };
}
