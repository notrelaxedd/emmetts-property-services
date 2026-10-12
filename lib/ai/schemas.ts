/** Zod schemas for every AI helper's input context and structured output (zod 4). */
import { z } from "zod";

export const businessContextSchema = z.object({
  name: z.string().min(1),
  area: z.string().min(1),
  phone: z.string().min(1),
  services: z.array(z.string()),
  voice: z.string().optional(),
});
export type BusinessContext = z.infer<typeof businessContextSchema>;

export const MESSAGE_KINDS = ["review", "reminder", "snow", "referral", "decline", "confirmation", "quote"] as const;
export type AiMessageKind = (typeof MESSAGE_KINDS)[number];

export const MAX_MESSAGE_BODY_CHARS = 1200;

// ---------- Outputs ----------

export const adOutputSchema = z.object({
  headline: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(1500),
  cta: z.string().trim().min(1).max(40),
});
export type AdDraft = z.infer<typeof adOutputSchema>;

export const messageOutputSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MESSAGE_BODY_CHARS)
    .refine((b) => !/unsubscribe|opt[- ]?out|reply stop/i.test(b), {
      message: "Body must not contain an unsubscribe/opt-out footer; the email layer adds it.",
    }),
});
export type MessageDraft = z.infer<typeof messageOutputSchema>;

export const customRequestOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    crew_size: z.number().int().min(1).max(6),
    hours_min: z.number().min(0).max(200),
    hours_max: z.number().min(0).max(200),
    price_min: z.number().min(0).max(100000),
    price_max: z.number().min(0).max(100000),
    risks: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .refine((v) => v.hours_min <= v.hours_max, { message: "hours_min must be <= hours_max", path: ["hours_max"] })
  .refine((v) => v.price_min <= v.price_max, { message: "price_min must be <= price_max", path: ["price_max"] });
export type CustomRequestSummary = z.infer<typeof customRequestOutputSchema>;

export const treeCoverOutputSchema = z.object({
  tree_cover: z.enum(["none", "light", "medium", "heavy"]),
  confidence: z.number().min(0).max(1),
  notes: z.string().trim().max(600),
});
export type TreeCoverEstimate = z.infer<typeof treeCoverOutputSchema>;

// ---------- JSON schema for tool input ----------

export type ToolInputSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; [k: string]: unknown };

/** Convert a zod object schema to the JSON schema Anthropic expects for `tool.input_schema`. */
export function toToolInputSchema(schema: z.ZodType): ToolInputSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") throw new Error("Tool input schema must be an object schema");
  return json as ToolInputSchema;
}

/** Human-readable zod error for the retry turn (short; no stack). */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}
