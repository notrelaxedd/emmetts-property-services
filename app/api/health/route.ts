import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational health check: which integrations are configured (names only, never values) and
 * whether the service-role database connection works. Safe to expose: it reveals nothing secret.
 */
export async function GET() {
  const present = (k: string) => Boolean(process.env[k]);
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: present("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    SUPABASE_URL: present("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
    ANTHROPIC_API_KEY: present("ANTHROPIC_API_KEY"),
    STRIPE_SECRET_KEY: present("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: present("STRIPE_WEBHOOK_SECRET"),
    NEXT_PUBLIC_SITE_URL: present("NEXT_PUBLIC_SITE_URL"),
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? "log",
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  let database: { ok: boolean; services?: number; error?: string } = { ok: false, error: "service-role client not configured" };
  const db = getSupabaseAdmin();
  if (db) {
    const { count, error } = await db.from("services").select("id", { count: "exact", head: true }).eq("active", true);
    database = error ? { ok: false, error: error.message } : { ok: true, services: count ?? 0 };
  }

  return NextResponse.json({ ok: database.ok, env, database }, { status: database.ok ? 200 : 503 });
}
