/**
 * The AI layer: typed helpers that draft ads and messages, summarize custom requests and estimate tree cover.
 *
 * This module (with client.ts, which it drives) is the ONLY place in the repo that calls the Anthropic API.
 * Every output is a DRAFT: callers must route it through the `approvals` inbox before anything reaches a customer.
 *
 * Each helper:
 *   1. asserts the monthly spend cap (raising a de-duplicated approval card and rethrowing if it is hit),
 *   2. sends a long static system prompt marked for prompt caching,
 *   3. gets structured output through a single tool call, validated with zod, retrying once with the
 *      validation error appended if the model's output is bad,
 *   4. logs every response's token usage to `ai_usage`.
 *
 * No `server-only` / `next/*` imports: fleet workers on Node 20 import this too.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { createMessage, resolveModel } from "./client";
import { supportsEffort, supportsForcedToolChoice } from "./pricing";
import {
  AD_SYSTEM_PROMPT,
  AD_TOOL_DESCRIPTION,
  AD_TOOL_NAME,
  CUSTOM_REQUEST_SYSTEM_PROMPT,
  CUSTOM_REQUEST_TOOL_DESCRIPTION,
  CUSTOM_REQUEST_TOOL_NAME,
  MESSAGE_SYSTEM_PROMPT,
  MESSAGE_TOOL_DESCRIPTION,
  MESSAGE_TOOL_NAME,
  TREE_COVER_SYSTEM_PROMPT,
  TREE_COVER_TOOL_DESCRIPTION,
  TREE_COVER_TOOL_NAME,
} from "./prompts";
import {
  adOutputSchema,
  customRequestOutputSchema,
  formatZodIssues,
  messageOutputSchema,
  toToolInputSchema,
  treeCoverOutputSchema,
  type AdDraft,
  type AiMessageKind,
  type BusinessContext,
  type CustomRequestSummary,
  type MessageDraft,
  type TreeCoverEstimate,
} from "./schemas";
import { AiCapExceededError, assertUnderCap, logUsage, raiseAiCapApproval } from "./usage";
import type { z } from "zod";

type Db = SupabaseClient<Database>;

export type { BusinessContext, AdDraft, MessageDraft, CustomRequestSummary, TreeCoverEstimate, AiMessageKind };
export { AiCapExceededError } from "./usage";
export { AiConfigError } from "./client";

export const defaultBusiness: BusinessContext = {
  name: "Emmett's Property Services",
  area: "Rocky River, Ohio and the nearby west-side Cleveland suburbs",
  phone: "(440) 823-5545",
  services: ["Lawn mowing", "Edging", "Fall leaf cleanup", "Gutter cleaning", "Snow removal"],
  voice:
    "Three local high-school students who do quality work at fair prices. Friendly, plain-spoken, neighborly. " +
    "No hype, no emojis, no em dashes.",
};

export type AdChannel = "facebook" | "instagram" | "nextdoor";

/** Per-call options. `worker` tags `ai_usage` rows with the fleet worker's name. */
export type AiCallOptions = { worker?: string | null; signal?: AbortSignal };

export class AiOutputError extends Error {
  readonly task: string;
  constructor(task: string, detail: string) {
    super(`AI output for "${task}" failed validation after one retry: ${detail}`);
    this.name = "AiOutputError";
    this.task = task;
  }
}

export class AiRefusalError extends Error {
  constructor(task: string, category?: string | null) {
    super(`The model declined the "${task}" request${category ? ` (${category})` : ""}.`);
    this.name = "AiRefusalError";
  }
}

// ---------- shared plumbing ----------

/** Ensure we are under the monthly cap; on breach raise the approval card (once) and rethrow. */
async function guardCap(db: Db, task: string, worker: string | null): Promise<void> {
  try {
    await assertUnderCap(db);
  } catch (err) {
    if (err instanceof AiCapExceededError) {
      try {
        await raiseAiCapApproval(db, task, { worker, spend: err.spend, cap: err.cap });
      } catch (raiseErr) {
        console.error("[ai] could not raise cap approval:", raiseErr);
      }
    }
    throw err;
  }
}

/** Customer-supplied text goes inside tags; neutralise angle brackets so it cannot close or open tags. */
function esc(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function businessBlock(b: BusinessContext): string {
  const lines = [
    `name: ${esc(b.name)}`,
    `service_area: ${esc(b.area)}`,
    `phone: ${esc(b.phone)}`,
    `services: ${b.services.map(esc).join(", ")}`,
  ];
  if (b.voice) lines.push(`voice_notes: ${esc(b.voice)}`);
  return `<business>\n${lines.join("\n")}\n</business>`;
}

/** Thrown from a `content()` builder to return a result without calling the API. */
class EarlyResult {
  constructor(readonly value: unknown) {}
}

type StructuredCall<T> = {
  db: Db;
  task: string;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  system: string;
  /** Built after the cap check passes, so we never download photos we are not allowed to pay to analyse. */
  content: () => Promise<Anthropic.ContentBlockParam[]>;
  effort: "low" | "medium";
  opts: AiCallOptions;
};

const MAX_TOKENS = 8000; // thinking tokens count toward max_tokens on the 5.x models

async function runStructured<T>(call: StructuredCall<T>): Promise<T> {
  const { db, task, toolName, schema } = call;
  const worker = call.opts.worker ?? null;
  await guardCap(db, task, worker);
  let content: Anthropic.ContentBlockParam[];
  try {
    content = await call.content();
  } catch (err) {
    if (err instanceof EarlyResult) return err.value as T;
    throw err;
  }

  const model = resolveModel();
  let forced = supportsForcedToolChoice(model);
  const inputSchema = toToolInputSchema(schema);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  let lastProblem = "";

  for (let validationAttempt = 0; validationAttempt < 2; validationAttempt++) {
    const buildParams = (): Anthropic.MessageCreateParamsNonStreaming => ({
      model,
      max_tokens: MAX_TOKENS,
      // Static system prompt first, with a cache breakpoint (tools + system form the cached prefix).
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      tools: [{ name: toolName, description: call.toolDescription, input_schema: inputSchema as Anthropic.Tool.InputSchema }],
      tool_choice: forced
        ? { type: "tool", name: toolName, disable_parallel_tool_use: true }
        : { type: "auto", disable_parallel_tool_use: true },
      ...(supportsEffort(model) ? { output_config: { effort: call.effort } } : {}),
      messages,
    });

    let response: Anthropic.Message;
    try {
      response = await createMessage(buildParams(), { label: task, signal: call.opts.signal });
    } catch (err) {
      // A newer model that rejects forced tool_choice: fall back to "auto" (the prompt already names the tool).
      const e = err as { status?: number; message?: string };
      if (forced && e.status === 400 && /tool_choice/i.test(e.message ?? "")) {
        forced = false;
        response = await createMessage(buildParams(), { label: task, signal: call.opts.signal });
      } else {
        throw err;
      }
    }

    await logUsage(db, { task, model, usage: response.usage, worker });

    if (response.stop_reason === "refusal") {
      const details = (response as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new AiRefusalError(task, details?.category);
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName,
    );
    const toolUse = toolUses[0];

    if (toolUse) {
      const parsed = schema.safeParse(toolUse.input);
      if (parsed.success) return parsed.data;
      lastProblem = formatZodIssues(parsed.error);
    } else {
      lastProblem =
        response.stop_reason === "max_tokens"
          ? "the response was cut off before the tool call finished"
          : `you did not call the ${toolName} tool`;
    }

    // Retry once with the validation error appended.
    if (validationAttempt === 0) {
      const echoed = response.content as unknown as Anthropic.ContentBlockParam[];
      if (response.content.length > 0) messages.push({ role: "assistant", content: echoed });
      const retryText = `Your last output was rejected: ${lastProblem}. Call ${toolName} again, exactly once, with corrected fields that satisfy every rule.`;
      const results: Anthropic.ContentBlockParam[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: retryText }));
      messages.push({
        role: "user",
        content: results.length > 0 ? results : [{ type: "text", text: retryText }],
      });
    }
  }

  throw new AiOutputError(task, lastProblem);
}

// ---------- photos ----------

export const MAX_PHOTOS = 4;
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function sniffMediaType(bytes: Uint8Array, headerType: string | null): ImageMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP"
  )
    return "image/webp";
  const h = (headerType ?? "").split(";")[0].trim().toLowerCase();
  if (h === "image/jpg") return "image/jpeg";
  if (h === "image/jpeg" || h === "image/png" || h === "image/gif" || h === "image/webp") return h;
  return null;
}

export type LoadedPhotos = { blocks: Anthropic.ImageBlockParam[]; notes: string[]; loaded: number };

/** Fetch each signed URL and turn it into a base64 image block. Failures are skipped and noted. Max 4 photos. */
export async function loadPhotos(photoUrls: string[]): Promise<LoadedPhotos> {
  const blocks: Anthropic.ImageBlockParam[] = [];
  const notes: string[] = [];
  const urls = photoUrls.slice(0, MAX_PHOTOS);
  if (photoUrls.length > MAX_PHOTOS) {
    notes.push(`${photoUrls.length - MAX_PHOTOS} extra photo(s) beyond the first ${MAX_PHOTOS} were not included.`);
  }
  for (let i = 0; i < urls.length; i++) {
    const label = `Photo ${i + 1}`;
    try {
      const res = await fetch(urls[i], { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        notes.push(`${label} could not be loaded (HTTP ${res.status}).`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mediaType = sniffMediaType(bytes, res.headers.get("content-type"));
      if (!mediaType) {
        notes.push(`${label} was skipped: unsupported image format.`);
        continue;
      }
      if (Math.ceil(bytes.length / 3) * 4 > MAX_IMAGE_BASE64_BYTES) {
        notes.push(`${label} was skipped: file too large.`);
        continue;
      }
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") },
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error";
      notes.push(`${label} could not be loaded (${reason}).`);
    }
  }
  return { blocks, notes, loaded: blocks.length };
}

// ---------- helpers ----------

export async function draftAd(
  db: Db,
  input: { channel: AdChannel; season: string; offer: string; business?: BusinessContext },
  opts: AiCallOptions = {},
): Promise<AdDraft> {
  const text =
    `${businessBlock(input.business ?? defaultBusiness)}\n` +
    `<request>\nchannel: ${input.channel}\nseason: ${esc(input.season)}\noffer: ${esc(input.offer)}\n</request>\n\n` +
    `Write one ${input.channel} ad and submit it with the ${AD_TOOL_NAME} tool.`;
  return runStructured({
    db,
    task: "draft_ad",
    toolName: AD_TOOL_NAME,
    toolDescription: AD_TOOL_DESCRIPTION,
    schema: adOutputSchema,
    system: AD_SYSTEM_PROMPT,
    content: async () => [{ type: "text", text }],
    effort: "medium",
    opts,
  });
}

export async function draftMessage(
  db: Db,
  input: {
    kind: AiMessageKind;
    customer: { name: string; first_name?: string };
    job?: { services: string[]; start_at?: string; address?: string };
    extra?: Record<string, string>;
    business?: BusinessContext;
  },
  opts: AiCallOptions = {},
): Promise<MessageDraft> {
  const lines = [`kind: ${input.kind}`, `customer_name: ${esc(input.customer.name)}`];
  if (input.customer.first_name) lines.push(`customer_first_name: ${esc(input.customer.first_name)}`);
  if (input.job) {
    lines.push(`job_services: ${input.job.services.map(esc).join(", ")}`);
    if (input.job.start_at) lines.push(`job_start: ${esc(input.job.start_at)}`);
    if (input.job.address) lines.push(`job_address: ${esc(input.job.address)}`);
  }
  for (const [k, v] of Object.entries(input.extra ?? {})) lines.push(`extra.${esc(k)}: ${esc(v)}`);
  const text =
    `${businessBlock(input.business ?? defaultBusiness)}\n<request>\n${lines.join("\n")}\n</request>\n\n` +
    `Write one "${input.kind}" message and submit it with the ${MESSAGE_TOOL_NAME} tool.`;
  return runStructured({
    db,
    task: `draft_message_${input.kind}`,
    toolName: MESSAGE_TOOL_NAME,
    toolDescription: MESSAGE_TOOL_DESCRIPTION,
    schema: messageOutputSchema,
    system: MESSAGE_SYSTEM_PROMPT,
    content: async () => [{ type: "text", text }],
    effort: "low",
    opts,
  });
}

export async function summarizeCustomRequest(
  db: Db,
  input: {
    note: string;
    photoUrls: string[];
    lotAcres: number | null;
    wage: number;
    margin: number;
    business?: BusinessContext;
  },
  opts: AiCallOptions = {},
): Promise<CustomRequestSummary> {
  return runStructured({
    db,
    task: "summarize_custom_request",
    toolName: CUSTOM_REQUEST_TOOL_NAME,
    toolDescription: CUSTOM_REQUEST_TOOL_DESCRIPTION,
    schema: customRequestOutputSchema,
    system: CUSTOM_REQUEST_SYSTEM_PROMPT,
    content: async () => {
      const photos = await loadPhotos(input.photoUrls);
      const photoLine =
        photos.loaded > 0 ? `${photos.loaded} photo(s) attached above.` : "No photos could be attached.";
      const text =
        `${businessBlock(input.business ?? defaultBusiness)}\n<request>\n` +
        `lot_acres: ${input.lotAcres ?? "unknown"}\nwage_per_crew_member_per_hour: ${input.wage}\n` +
        `target_margin: ${input.margin}\n${photoLine}\n` +
        (photos.notes.length ? `photo_notes:\n${photos.notes.map((n) => `- ${n}`).join("\n")}\n` : "") +
        `</request>\n<customer_note>\n${esc(input.note)}\n</customer_note>\n\n` +
        `Summarize this custom request for the owner and submit it with the ${CUSTOM_REQUEST_TOOL_NAME} tool. ` +
        `The price range is a suggestion for the owner only.`;
      return [...photos.blocks, { type: "text", text }];
    },
    effort: "medium",
    opts,
  });
}

export async function estimateFromPhotos(
  db: Db,
  input: { photoUrls: string[]; lotAcres: number | null },
  opts: AiCallOptions = {},
): Promise<TreeCoverEstimate> {
  return runStructured({
    db,
    task: "estimate_from_photos",
    toolName: TREE_COVER_TOOL_NAME,
    toolDescription: TREE_COVER_TOOL_DESCRIPTION,
    schema: treeCoverOutputSchema,
    system: TREE_COVER_SYSTEM_PROMPT,
    content: async () => {
      const photos = await loadPhotos(input.photoUrls);
      if (photos.loaded === 0) {
        // Nothing to judge: skip the API call and make the lack of evidence explicit (confidence 0).
        throw new EarlyResult({
          tree_cover: "medium",
          confidence: 0,
          notes: `No usable photos, so this is a placeholder. ${photos.notes.join(" ")}`.trim(),
        } satisfies TreeCoverEstimate);
      }
      const text =
        `<request>\nlot_acres: ${input.lotAcres ?? "unknown"}\n${photos.loaded} photo(s) attached above.\n` +
        (photos.notes.length ? `photo_notes:\n${photos.notes.map((n) => `- ${n}`).join("\n")}\n` : "") +
        `</request>\n\nJudge the tree cover and submit it with the ${TREE_COVER_TOOL_NAME} tool.`;
      return [...photos.blocks, { type: "text", text }];
    },
    effort: "low",
    opts,
  });
}

/** Bind a fleet worker name so every helper tags its `ai_usage` rows (and any cap approval) with it. */
export function withWorkerName(worker: string) {
  return {
    worker,
    draftAd: (db: Db, input: Parameters<typeof draftAd>[1]) => draftAd(db, input, { worker }),
    draftMessage: (db: Db, input: Parameters<typeof draftMessage>[1]) => draftMessage(db, input, { worker }),
    summarizeCustomRequest: (db: Db, input: Parameters<typeof summarizeCustomRequest>[1]) =>
      summarizeCustomRequest(db, input, { worker }),
    estimateFromPhotos: (db: Db, input: Parameters<typeof estimateFromPhotos>[1]) =>
      estimateFromPhotos(db, input, { worker }),
  };
}
