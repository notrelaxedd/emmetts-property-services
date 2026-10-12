/**
 * Zod schemas for every `fleet_tasks.payload`, by task type. The worker validates each claimed
 * task's payload with these before running it; a payload that fails is marked `failed` at once.
 * Unknown extra keys are allowed (and ignored) so older/newer enqueuers stay compatible.
 */
import { z } from "zod";
import type { FleetTaskType } from "../../lib/db/types";

/** Any 8-4-4-4-12 hex id (z.guid accepts the all-zero style ids that seeds use). */
const id = z.guid();

export const quotePayload = z.looseObject({ lead_id: id });
export const customSummaryPayload = z.looseObject({ lead_id: id });
export const schedulePayload = z.looseObject({
  reason: z.string().trim().min(1).max(200).default("sweep"),
  job_ids: z.array(id).max(200).optional(),
});
export const adDraftPayload = z.looseObject({
  channel: z.enum(["facebook", "instagram", "nextdoor"]),
  season: z.string().trim().min(1).max(40),
  offer: z.string().trim().min(1).max(200),
});
export const followupReviewPayload = z.looseObject({ job_id: id });
export const followupReminderPayload = z.looseObject({ job_id: id });
export const weatherWatchPayload = z.looseObject({ slot: z.string().max(40).optional() });
export const sendMessagePayload = z.looseObject({ message_id: id });

export const payloadSchemas = {
  quote: quotePayload,
  custom_summary: customSummaryPayload,
  schedule: schedulePayload,
  ad_draft: adDraftPayload,
  followup_review: followupReviewPayload,
  followup_reminder: followupReminderPayload,
  weather_watch: weatherWatchPayload,
  send_message: sendMessagePayload,
} satisfies Record<FleetTaskType, z.ZodType>;

export type QuotePayload = z.infer<typeof quotePayload>;
export type CustomSummaryPayload = z.infer<typeof customSummaryPayload>;
export type SchedulePayload = z.infer<typeof schedulePayload>;
export type AdDraftPayload = z.infer<typeof adDraftPayload>;
export type FollowupReviewPayload = z.infer<typeof followupReviewPayload>;
export type FollowupReminderPayload = z.infer<typeof followupReminderPayload>;
export type WeatherWatchPayload = z.infer<typeof weatherWatchPayload>;
export type SendMessagePayload = z.infer<typeof sendMessagePayload>;
