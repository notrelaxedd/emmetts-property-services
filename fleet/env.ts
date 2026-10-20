/** Worker environment, validated once at startup. */
import { hostname } from "node:os";
import { z } from "zod";
import type { FleetRole } from "../lib/db/types";

export const FLEET_ROLES = ["ads", "quotes", "scheduler", "followup", "host"] as const satisfies readonly FleetRole[];

/** `all` runs every role in one process: for a laptop or a single box, not the 4-box fleet. */
const envSchema = z.object({
  FLEET_ROLE: z.enum([...FLEET_ROLES, "all"]),
  FLEET_NAME: z.string().trim().min(1).max(64).optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Required by roles that call Claude (ads, quotes, followup); lib/ai reads it from process.env. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Public site URL, used in unsubscribe links and Stripe redirect URLs. */
  SITE_URL: z.string().url().optional(),
});

export type FleetEnv = {
  role: FleetRole | "all";
  name: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  siteUrl: string;
  hasAnthropicKey: boolean;
};

/** Roles that draft with Claude. A missing key is a warning, not a crash: those tasks fall back or fail visibly. */
export const AI_ROLES: ReadonlySet<FleetRole> = new Set<FleetRole>(["ads", "quotes", "followup"]);

export function parseEnv(env: Record<string, string | undefined> = process.env): FleetEnv {
  const r = envSchema.safeParse(env);
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid fleet env: ${detail}`);
  }
  const e = r.data;
  return {
    role: e.FLEET_ROLE,
    name: e.FLEET_NAME ?? (e.FLEET_ROLE === "all" ? hostname() : `${e.FLEET_ROLE}-${hostname()}`),
    supabaseUrl: e.SUPABASE_URL,
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    siteUrl: (e.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    hasAnthropicKey: Boolean(e.ANTHROPIC_API_KEY),
  };
}
