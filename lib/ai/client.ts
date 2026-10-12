/**
 * Anthropic client + retry loop. Reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL only (never NEXT_PUBLIC_*).
 * No `server-only` / `next/*` imports: fleet workers on Node 20 import this module too.
 *
 * The SDK is constructed with `maxRetries: 0`; `createMessage` owns retries so every attempt is logged.
 */
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

/** The configured model id. Haiku models are never allowed (plan: quality over cost for customer-facing drafts). */
export function resolveModel(env: Record<string, string | undefined> = process.env): string {
  const model = (env.ANTHROPIC_MODEL ?? "").trim() || DEFAULT_MODEL;
  if (/haiku/i.test(model)) {
    throw new AiConfigError(
      `ANTHROPIC_MODEL="${model}" is not allowed: Haiku models are not permitted for this app. ` +
        `Use ${DEFAULT_MODEL} or another Sonnet/Opus model.`,
    );
  }
  return model;
}

let cached: { key: string; client: Anthropic } | null = null;

export function getAnthropic(env: Record<string, string | undefined> = process.env): Anthropic {
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) throw new AiConfigError("ANTHROPIC_API_KEY is not set (server-side env only).");
  if (cached && cached.key === apiKey) return cached.client;
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  cached = { key: apiKey, client };
  return client;
}

/** Test hook: drop the memoised client. */
export function resetAnthropicClient(): void {
  cached = null;
}

// ---------- Retry ----------

/** Mutable so tests can make backoff instant and deterministic. */
export const retryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  /** Longest `retry-after` we will honour; beyond this we give up rather than stall a worker. */
  maxRetryAfterMs: 60_000,
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
};

type ErrorLike = {
  status?: number;
  headers?: unknown;
  type?: string | null;
  error?: unknown;
  name?: string;
  message?: string;
};

export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as ErrorLike;
  if (typeof e.status === "number") {
    if (e.status === 408 || e.status === 409 || e.status === 429 || e.status === 529) return true;
    if (e.status >= 500) return true;
    return false;
  }
  // No status: connection errors / timeouts surface as APIConnectionError, or overloaded body without status.
  if (e.type === "overloaded_error" || e.type === "rate_limit_error") return true;
  const body = JSON.stringify(e.error ?? "");
  if (/overloaded_error/.test(body)) return true;
  return /connection|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(`${e.name ?? ""} ${e.message ?? ""}`);
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const h = headers as { get?: (n: string) => string | null } & Record<string, unknown>;
  if (typeof h.get === "function") return h.get(name) ?? null;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  const v = key ? h[key] : undefined;
  return typeof v === "string" ? v : null;
}

/** Milliseconds from `retry-after-ms` / `retry-after` (seconds or HTTP date), or null. */
export function retryAfterMs(err: unknown): number | null {
  const headers = (err as ErrorLike | null)?.headers;
  const ms = headerValue(headers, "retry-after-ms");
  if (ms !== null && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const ra = headerValue(headers, "retry-after");
  if (ra === null) return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(ra);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function backoffDelayMs(attempt: number, err?: unknown): number {
  const hinted = err === undefined ? null : retryAfterMs(err);
  if (hinted !== null) return Math.min(hinted, retryConfig.maxRetryAfterMs);
  const exp = Math.min(retryConfig.maxDelayMs, retryConfig.baseDelayMs * 2 ** (attempt - 1));
  // 50%..100% of the exponential step.
  return Math.round(exp * (0.5 + retryConfig.random() * 0.5));
}

export type AttemptInfo = { attempt: number; maxAttempts: number; delayMs: number; error: unknown };

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { label?: string; onRetry?: (info: AttemptInfo) => void } = {},
): Promise<T> {
  const max = retryConfig.maxAttempts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= max || !isRetryableError(err)) throw err;
      const retryAfter = retryAfterMs(err);
      if (retryAfter !== null && retryAfter > retryConfig.maxRetryAfterMs) throw err;
      const delayMs = backoffDelayMs(attempt, err);
      const info: AttemptInfo = { attempt, maxAttempts: max, delayMs, error: err };
      if (opts.onRetry) opts.onRetry(info);
      else {
        const status = (err as ErrorLike).status ?? "network";
        console.warn(
          `[ai] ${opts.label ?? "request"} attempt ${attempt}/${max} failed (${status}); retrying in ${delayMs}ms`,
        );
      }
      await retryConfig.sleep(delayMs);
    }
  }
}

/** One Messages API call with the retry policy applied. */
export function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: { label?: string; signal?: AbortSignal; env?: Record<string, string | undefined> } = {},
): Promise<Anthropic.Message> {
  const client = getAnthropic(opts.env);
  return withRetries(() => client.messages.create(params, opts.signal ? { signal: opts.signal } : undefined), {
    label: opts.label,
  });
}
