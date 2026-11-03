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

const SEASONS: readonly Season[] = ["spring", "summer", "fall", "winter"];

const SEASON_OFFER: Record<Season, string> = {
  spring: "Spring cleanup and weekly mowing",
  summer: "Weekly mowing and edging",
  fall: "Fall leaf cleanup",
  winter: "Snow removal",
};

/**
 * Writing angles. Each draft takes one, skipping the angles the last few ads used, so drafts on the
 * same topic don't come out sounding alike. The text is what Claude is told to do.
 */
export const AD_ANGLES: Record<string, string> = {
  problem: "Open on the problem the homeowner is looking at right now, then show the crew taking it off their plate.",
  time_back: "Lead with what they get to do instead of yard work this weekend. The work is the background, their free time is the point.",
  window: "Frame it around the seasonal window closing (before the ground freezes, before the first snow). No specific dates.",
  local: "Neighbor to neighbor: the crew works these streets and is close by. Warm and plain.",
  question: "Open with one direct question the reader would answer yes to, then answer it.",
  included: "Concrete and practical: spell out what the job actually covers, step by step in short sentences.",
  after: "Paint the result: how the yard, driveway or walk looks when the crew is done.",
  easy: "Make booking sound effortless: what they send, what happens next, how little they have to do.",
  blunt: "Very short and blunt. Use the bottom of the channel's length range. No warm-up line.",
};
const ANGLE_KEYS = Object.keys(AD_ANGLES);

/** A random angle the last `avoid` ads didn't use (falls back to any angle). */
export function pickAngle(recentAngles: (string | null)[], rand: () => number = Math.random, avoid = 4): string {
  const used = new Set(recentAngles.slice(0, avoid).filter(Boolean));
  const pool = ANGLE_KEYS.filter((k) => !used.has(k));
  const from = pool.length ? pool : ANGLE_KEYS;
  return from[Math.floor(rand() * from.length) % from.length];
}

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
  // No offer given (the admin form's optional field): lead with what the site is leading with.
  const season = (SEASONS as readonly string[]).includes(payload.season) ? (payload.season as Season) : seasonOf(now);
  const offer = payload.offer.trim() || currentOffer(season);
  const base = `${payload.channel}-${payload.season}-${yyyymmdd(now)}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const { code, reuse } = await freeUtmCode(db, base);

  const topic = (payload.topic ?? "").trim();
  // The last ads (any channel) so Claude writes something that reads different, and the angles to skip.
  const recent =
    check(
      await db.from("ads").select("id,channel,headline,body,cta,angle").order("created_at", { ascending: false }).limit(11),
      "ad_draft(recent)",
    ) ?? [];
  const others = recent.filter((r) => r.id !== reuse?.id).slice(0, 10);
  const angle = pickAngle(others.map((r) => r.angle));

  let draft;
  try {
    draft = await ctx.ai.draftAd(db, {
      channel: payload.channel,
      season: payload.season,
      offer,
      topic,
      angle: AD_ANGLES[angle],
      recent: others.map((r) => ({ channel: r.channel, headline: r.headline, body: r.body, cta: r.cta })),
    });
  } catch (e) {
    if (e instanceof AiCapExceededError) return { skipped: "ai_cap" };
    throw e;
  }

  const settings = await getSettings(db);
  const center = { lat: settings.base_lat ?? opsConfig.defaultBase.lat, lng: settings.base_lng ?? opsConfig.defaultBase.lng };
  const fields = {
    channel: payload.channel, headline: draft.headline, body: draft.body, cta: draft.cta, season: payload.season,
    offer, topic: topic || null, angle, utm_code: code, status: "draft" as const,
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
      summary: `${topic ? `${topic} · ` : ""}${payload.season} · ${offer} · utm ${ad.utm_code}`,
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
