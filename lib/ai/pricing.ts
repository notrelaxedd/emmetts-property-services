/**
 * Token prices and per-model capabilities for the AI layer.
 *
 * Prices are USD per million tokens, from Anthropic's published first-party rates (as listed in the
 * claude-api skill, cached 2026-10-06). `cacheWrite` is the 5-minute ephemeral write rate (1.25x input),
 * which is what `cache_control: { type: "ephemeral" }` uses.
 *
 * Pure module: no I/O, no framework imports (fleet workers on Node 20 import this too).
 */

export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Model used when a rate is unknown. Unknown models are priced at this model's rate and flagged. */
export const FALLBACK_PRICE_MODEL = "claude-sonnet-5-5";

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Haiku is refused at runtime (see client.ts); kept so historical or imported rows still price correctly.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type PriceLookup = { price: ModelPrice; known: boolean; matched: string };

/** Strip a trailing date suffix such as `-20251101` so snapshot ids resolve to the family rate. */
function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/-\d{8}$/, "");
}

export function lookupPrice(model: string): PriceLookup {
  const id = normalizeModelId(model);
  const hit = PRICE_TABLE[id];
  if (hit) return { price: hit, known: true, matched: id };
  return { price: PRICE_TABLE[FALLBACK_PRICE_MODEL], known: false, matched: FALLBACK_PRICE_MODEL };
}

export type CostEstimate = { est_cost: number; known: boolean; matched: string };

/** USD cost of one response, rounded to 6 decimal places (micro-dollars). */
export function estimateCost(model: string, usage: TokenUsage): CostEstimate {
  const { price, known, matched } = lookupPrice(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const dollars =
    (input * price.input + output * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) /
    1_000_000;
  return { est_cost: Math.round(dollars * 1e6) / 1e6, known, matched };
}

/**
 * Models that reject forced `tool_choice` (`{type:"tool"}` / `{type:"any"}`) with a 400. For these we send
 * `tool_choice: {type:"auto"}` and name the tool in the prompt instead; the zod validate-and-retry loop
 * covers the rare case where the model answers in prose.
 */
const NO_FORCED_TOOL_CHOICE = [/^claude-sonnet-5-5/, /^claude-opus-5-5/, /^claude-fable-5-1/, /^claude-mythos-5-1/];

export function supportsForcedToolChoice(model: string): boolean {
  const id = normalizeModelId(model);
  return !NO_FORCED_TOOL_CHOICE.some((re) => re.test(id));
}

/** Models that accept `output_config.effort` (the 5.x generation). Older models 400 on it. */
const EFFORT_MODELS = [/^claude-sonnet-5/, /^claude-opus-5/, /^claude-fable-5/, /^claude-mythos-5/];

export function supportsEffort(model: string): boolean {
  const id = normalizeModelId(model);
  return EFFORT_MODELS.some((re) => re.test(id));
}
