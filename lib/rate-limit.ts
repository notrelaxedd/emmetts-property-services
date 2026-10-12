/**
 * In-memory sliding-window rate limiter.
 *
 * Best-effort only: on Vercel every serverless instance has its own memory and instances are
 * ephemeral, so the limit is per warm instance, not global. It still stops a single client
 * hammering one instance; Turnstile (when configured) is the real bot defence.
 * Pure (no next/* imports) so it's unit-testable.
 */

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export type RateLimiter = {
  /** Records a hit for `key` and says whether it is within the limit. */
  hit(key: string, now?: number): RateLimitResult;
  /** Test hook. */
  reset(): void;
};

const MAX_KEYS = 5000;

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();

  function sweep(now: number) {
    hits.forEach((times, k) => {
      if (times.length === 0 || times[times.length - 1] <= now - opts.windowMs) hits.delete(k);
    });
  }

  return {
    hit(key, now = Date.now()) {
      if (hits.size > MAX_KEYS) sweep(now);
      const recent = (hits.get(key) ?? []).filter((t) => t > now - opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: recent[0] + opts.windowMs - now };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true };
    },
    reset() {
      hits.clear();
    },
  };
}

/** Quote form: 5 submissions per 10 minutes per client IP. */
export const quoteRateLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

/** Client IP from `x-forwarded-for` (first hop), falling back to `x-real-ip`, else "unknown". */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}
