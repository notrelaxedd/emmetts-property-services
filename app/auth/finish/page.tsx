import type { Metadata } from "next";
import { AuthHashCatcher } from "@/components/site/auth-hash-catcher";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false, follow: false } };

/**
 * Landing for Supabase links that carry the session in the URL fragment (#access_token=…), which a
 * server route can never see. The catcher stores the session and forwards the user.
 */
export default function AuthFinishPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <p className="text-sm text-ink-muted">Signing you in…</p>
      <AuthHashCatcher />
    </main>
  );
}
