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

  // The browser/auth path uses the PUBLIC url + anon key, not the service role: check it separately.
  let auth: { ok: boolean; host?: string; sameProject?: boolean; status?: number; error?: string } = { ok: false };
  const pubUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (pubUrl && anon) {
    let host: string | undefined;
    try {
      host = new URL(pubUrl).host;
    } catch {
      auth = { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL is not a valid URL" };
    }
    if (host) {
      const sameProject = (() => {
        try {
          return new URL(process.env.SUPABASE_URL ?? pubUrl).host === host;
        } catch {
          return false;
        }
      })();
      try {
        const r = await fetch(`${pubUrl.replace(/\/$/, "")}/auth/v1/settings`, {
          headers: { apikey: anon.trim(), Authorization: `Bearer ${anon.trim()}` },
          cache: "no-store",
        });
        const body = (await r.json().catch(() => ({}))) as { external?: { email?: boolean }; msg?: string; message?: string };
        auth = {
          ok: r.ok && body.external?.email !== false,
          host,
          sameProject,
          status: r.status,
          error: r.ok ? (body.external?.email === false ? "email provider disabled in Supabase Auth settings" : undefined) : (body.msg ?? body.message ?? `HTTP ${r.status}`),
        };
      } catch (e) {
        auth = { ok: false, host, sameProject, error: e instanceof Error ? e.message : String(e) };
      }
    }
  } else {
    auth = { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set" };
  }

  const ok = database.ok && auth.ok;
  return NextResponse.json({ ok, env, database, auth }, { status: ok ? 200 : 503 });
}
