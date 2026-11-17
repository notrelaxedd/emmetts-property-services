/**
 * Logs a server-action POST to a public page into `action_requests` (migration 20261117000200).
 * Called from middleware.ts, which runs before Next.js looks the action up: a request it then rejects
 * ("Failed to find Server Action") never reaches our code, so this row is the only record of who sent
 * it. Edge-safe (plain fetch to Supabase's REST API, no supabase-js) and never throws.
 */
import type { NextRequest } from "next/server";
import { clientIpFrom, createRateLimiter } from "./rate-limit";

/** Per warm instance: enough for real use, but a flood from one address can't fill the table. */
const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

const clip = (v: string | null | undefined, n: number): string | null => (v ? v.slice(0, n) : null);

/** The row to store. Pure (exported for tests). */
export function actionRequestRow(request: NextRequest) {
  const ip = request.ip ?? clientIpFrom(request.headers);
  const h = request.headers;
  const decode = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    path: request.nextUrl.pathname.slice(0, 300),
    action_id: (h.get("next-action") ?? "").slice(0, 200),
    ip: clip(ip === "unknown" ? null : ip, 64),
    user_agent: clip(h.get("user-agent"), 400),
    referer: clip(h.get("referer"), 400),
    country: clip(request.geo?.country ?? h.get("x-vercel-ip-country"), 8),
    region: clip(request.geo?.region ?? h.get("x-vercel-ip-country-region"), 16),
    city: clip(decode(request.geo?.city ?? h.get("x-vercel-ip-city")), 80),
  };
}

export async function logActionRequest(request: NextRequest): Promise<void> {
  try {
    const row = actionRequestRow(request);
    if (!limiter.hit(row.ip ?? "unknown").ok) return;
    console.log("[action-request]", JSON.stringify(row));
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/action_requests`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[action-request] save failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    console.error("[action-request] save failed:", e instanceof Error ? e.message : e);
  }
}
