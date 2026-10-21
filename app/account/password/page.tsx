import type { Metadata } from "next"
import { requireRole } from "@/lib/auth/session"
import { PasswordForm } from "./password-form"

export const metadata: Metadata = { title: "Set password", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

/** Owner and crew set or change their password here (after a magic-link sign-in, or any time). */
export default async function PasswordPage({ searchParams }: { searchParams: { welcome?: string } }) {
  const session = await requireRole("owner", "crew")
  const home = session.profile.role === "owner" ? "/admin" : "/crew"
  const welcome = searchParams.welcome === "1"
  const firstName = session.profile.name?.split(/\s+/)[0] || null
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {welcome ? `Welcome${firstName ? `, ${firstName}` : ""}!` : "Set your password"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {welcome
            ? `Your account (${session.email ?? session.profile.name}) is ready. Choose a password so you can sign in any time with email and password; then you'll see your jobs.`
            : `Signed in as ${session.email ?? session.profile.name}. Next time you can sign in with email and password.`}
        </p>
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
          <PasswordForm home={home} />
        </div>
      </div>
    </main>
  )
}
