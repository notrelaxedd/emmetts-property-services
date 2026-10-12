/**
 * `weather_watch` (role followup; the host enqueues it every 6 h). Reads the free NWS forecast for
 * the service area and:
 *  - snow in the next 3 days → ONE snow-plan draft (AI once, reused for everyone) → a `messages`
 *    draft per snow-list customer with email opt-in → ONE `followup` approval with
 *    `{ message_ids, kind: "snow", subject, body }`. At most one batch per 72 h.
 *  - rain ≥ 50% in the next 3 days → booked jobs in those periods → one `weather_hold` approval per
 *    rainy day with `{ job_ids, day, forecast }`. At most one card per day's jobs per 24 h. With
 *    weather_hold autopilot on, the hold is applied straight away (jobs marked for re-planning).
 */
import type { Job } from "../../lib/db/types";
import { opsConfig } from "../../lib/config";
import { applyApproval, requestApproval } from "../../lib/ops/approvals";
import "../../lib/ops/handlers";
import { getSettings } from "../../lib/ops/settings";
import { check } from "../../lib/ops/types";
import { formatDayLabel, localDate } from "../../lib/scheduler/time";
import { getForecast, summarizeForecast, weatherHoldCandidates } from "../../lib/weather";
import type { ForecastSummary } from "../../lib/weather";
import type { TaskContext } from "../context";
import { errorMessage } from "../log";
import { snowTemplate } from "../templates";
import { HOUR_MS } from "../time";
import { draftOr } from "./followup_common";
import type { WeatherWatchPayload } from "./schemas";

export const SNOW_BATCH_WINDOW_HOURS = 72;
export const HOLD_CARD_WINDOW_HOURS = 24;
export const FORECAST_DAYS = 3;

export async function runWeatherWatch(ctx: TaskContext, _payload: WeatherWatchPayload): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const now = ctx.now();
  const settings = await getSettings(db);
  const base = {
    lat: settings.base_lat ?? opsConfig.defaultBase.lat,
    lng: settings.base_lng ?? opsConfig.defaultBase.lng,
  };
  const periods = await getForecast(base);
  const summary = summarizeForecast(periods, { days: FORECAST_DAYS });
  const out: Record<string, unknown> = { snow: summary.snow.expected, rain: summary.rain.expected };
  if (summary.snow.expected) out.snow_result = await snowPlan(ctx, summary, now);
  if (summary.rain.expected) out.rain_result = await rainHolds(ctx, summary, now);
  return out;
}

async function snowPlan(ctx: TaskContext, summary: ForecastSummary, now: Date): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const since = new Date(now.getTime() - SNOW_BATCH_WINDOW_HOURS * HOUR_MS).toISOString();
  const recent = check(
    await db.from("messages").select("id").eq("kind", "snow").gte("created_at", since).limit(1),
    "weather(recent snow)",
  );
  if ((recent ?? []).length > 0) return { skipped: "snow plan already drafted in the last 72 h" };

  const customers = (
    check(await db.from("customers").select("*").eq("snow_list", true).eq("email_opt_in", true), "weather(snow list)") ?? []
  ).filter((c) => !!c.email);
  if (!customers.length) return { skipped: "nobody on the snow list with email opt-in" };

  // One draft for everyone (the snow plan is the same for every driveway); greeting stays generic.
  const draft = await draftOr(
    ctx,
    () =>
      ctx.ai.draftMessage(db, {
        kind: "snow",
        customer: { name: "Snow list customer", first_name: "there" },
        extra: { forecast: summary.snow.detail, note: "This one email goes to every snow-list customer; greet them generically." },
      }),
    snowTemplate({ detail: summary.snow.detail }),
  );

  const rows = customers.map((c) => ({
    customer_id: c.id, job_id: null, quote_id: null, channel: "email" as const, kind: "snow" as const,
    subject: draft.subject, body: draft.body, status: "draft" as const,
  }));
  const inserted = check(await db.from("messages").insert(rows).select("*"), "weather(snow messages)") ?? [];
  const messageIds = inserted.map((m) => m.id);

  const { approval, autoApproved } = await requestApproval(db, {
    kind: "followup",
    ref_table: "messages",
    ref_id: messageIds[0],
    payload: { message_ids: messageIds, kind: "snow", subject: draft.subject, body: draft.body, forecast: summary.snow.detail },
    title: `Snow plan email to ${messageIds.length} customer${messageIds.length === 1 ? "" : "s"}`,
    summary: summary.snow.detail,
    created_by: ctx.worker,
  });
  let sent = false;
  if (autoApproved) {
    // The followup handler sends every id in `message_ids` (skipping ones already sent).
    try {
      sent = await applyApproval(db, approval, { siteUrl: ctx.siteUrl, actor: ctx.worker });
    } catch (e) {
      const note = `autopilot send failed: ${errorMessage(e)}`.slice(0, 500);
      ctx.log.warn("autopilot snow send failed", { approval: approval.id, err: note });
      check(
        await db.from("approvals").update({ status: "pending", decided_at: null, decided_by: null, decision_note: note }).eq("id", approval.id),
        "weather(revert autopilot)",
      );
    }
  }
  return { message_ids: messageIds.length, approval_id: approval.id, auto_sent: sent, draft: draft.source };
}

async function rainHolds(ctx: TaskContext, summary: ForecastSummary, now: Date): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const until = new Date(now.getTime() + FORECAST_DAYS * 24 * HOUR_MS).toISOString();
  const booked = (
    check(await db.from("jobs").select("*").eq("status", "booked").eq("weather_hold", false), "weather(booked)") ?? []
  ).filter((j) => j.start_at && j.start_at >= now.toISOString() && j.start_at <= until);
  const ids = weatherHoldCandidates(booked, summary);
  if (!ids.length) return { holds: 0 };

  const byDay: Record<string, Job[]> = {};
  for (const j of booked) {
    if (!ids.includes(j.id)) continue;
    const day = localDate(new Date(j.start_at as string));
    (byDay[day] ??= []).push(j);
  }

  const since = new Date(now.getTime() - HOLD_CARD_WINDOW_HOURS * HOUR_MS).toISOString();
  let cards = 0;
  let autoHeld = 0;
  for (const day of Object.keys(byDay).sort()) {
    const jobs = byDay[day].sort((a, b) => (a.start_at as string).localeCompare(b.start_at as string));
    const jobIds = jobs.map((j) => j.id);
    const recent = (
      check(await db.from("approvals").select("*").eq("kind", "weather_hold").in("ref_id", jobIds), "weather(recent holds)") ?? []
    ).filter((a) => a.created_at >= since);
    if (recent.length) continue; // asked about these jobs within the last day (pending, approved or rejected)
    const label = formatDayLabel(new Date(jobs[0].start_at as string));
    const { approval, autoApproved } = await requestApproval(db, {
      kind: "weather_hold",
      ref_table: "jobs",
      ref_id: jobIds[0],
      payload: { job_ids: jobIds, day, forecast: summary.rain.detail },
      title: `Rain ${label}: hold ${jobIds.length} job${jobIds.length === 1 ? "" : "s"}?`,
      summary: summary.rain.detail,
      created_by: ctx.worker,
    });
    cards++;
    if (autoApproved) {
      try {
        if (await applyApproval(db, approval, { siteUrl: ctx.siteUrl, actor: ctx.worker })) autoHeld += jobIds.length;
      } catch (e) {
        const note = `autopilot hold failed: ${errorMessage(e)}`.slice(0, 500);
        ctx.log.warn("autopilot weather hold failed", { approval: approval.id, err: note });
        check(
          await db.from("approvals").update({ status: "pending", decided_at: null, decided_by: null, decision_note: note }).eq("id", approval.id),
          "weather(revert autopilot hold)",
        );
      }
    }
  }
  return { holds: cards, jobs: ids.length, auto_held: autoHeld };
}
