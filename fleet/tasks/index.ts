/**
 * Dispatch table: task type → { role, payload schema, runner }. The worker validates the payload
 * with the schema (a bad payload fails the task permanently) and calls the runner.
 */
import type { z } from "zod";
import type { FleetRole, FleetTask, FleetTaskType } from "../../lib/db/types";
import { taskRoleFor } from "../../lib/ops/tasks";
import type { TaskContext } from "../context";
import { PermanentTaskError } from "../errors";
import { runAdDraft } from "./ad_draft";
import { runCustomSummary } from "./custom_summary";
import { runFollowupReminder } from "./followup_reminder";
import { runFollowupReview } from "./followup_review";
import { runQuote } from "./quote";
import { runSchedule } from "./schedule";
import { payloadSchemas } from "./schemas";
import { runSendMessage } from "./send_message";
import { runWeatherWatch } from "./weather_watch";

export type TaskResult = Record<string, unknown>;

type Entry<S extends z.ZodType> = {
  role: FleetRole;
  schema: S;
  run: (ctx: TaskContext, payload: z.infer<S>) => Promise<TaskResult>;
};

function entry<S extends z.ZodType>(type: FleetTaskType, schema: S, run: Entry<S>["run"]): Entry<S> {
  return { role: taskRoleFor(type), schema, run };
}

export const TASKS = {
  quote: entry("quote", payloadSchemas.quote, (c, p) => runQuote(c, p) as Promise<TaskResult>),
  custom_summary: entry("custom_summary", payloadSchemas.custom_summary, runCustomSummary),
  schedule: entry("schedule", payloadSchemas.schedule, (c, p) => runSchedule(c, p) as Promise<TaskResult>),
  ad_draft: entry("ad_draft", payloadSchemas.ad_draft, runAdDraft),
  followup_review: entry("followup_review", payloadSchemas.followup_review, runFollowupReview),
  followup_reminder: entry("followup_reminder", payloadSchemas.followup_reminder, runFollowupReminder),
  weather_watch: entry("weather_watch", payloadSchemas.weather_watch, runWeatherWatch),
  send_message: entry("send_message", payloadSchemas.send_message, runSendMessage),
} satisfies Record<FleetTaskType, Entry<z.ZodType>>;

/** Task types a role runs (empty for `host`, which only schedules). */
export function typesForRole(role: FleetRole): FleetTaskType[] {
  return (Object.keys(TASKS) as FleetTaskType[]).filter((t) => TASKS[t].role === role);
}

/** Validate the payload and run the task. Throws PermanentTaskError for unknown types / bad payloads. */
export async function dispatch(ctx: TaskContext, task: Pick<FleetTask, "id" | "type" | "payload">): Promise<TaskResult> {
  const e = (TASKS as Record<string, Entry<z.ZodType> | undefined>)[task.type];
  if (!e) throw new PermanentTaskError(`no handler for task type "${task.type}"`);
  const parsed = e.schema.safeParse(task.payload ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new PermanentTaskError(`invalid ${task.type} payload: ${detail}`);
  }
  return e.run(ctx, parsed.data);
}
