import type { Metadata } from "next"
import Link from "next/link"
import { MailCheck } from "lucide-react"
import { safeNext } from "../redirects"

export const metadata: Metadata = {
  title: "Check your email",
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default function CheckEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const email = (one(searchParams.email) ?? "").slice(0, 200)
  const next = safeNext(one(searchParams.next))
  const back = next ? `/login?next=${encodeURIComponent(next)}` : "/login"

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-ink/10 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-brand-green/20 text-brand-green-dark">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {email ? (
            <>
              If <span className="font-semibold text-ink">{email}</span> is on the invite list, a sign-in link is on its way.
            </>
          ) : (
            "If that address is on the invite list, a sign-in link is on its way."
          )}{" "}
          It can take a minute, and it works once.
        </p>
        <Link
          href={back}
          className="mt-5 inline-block text-sm font-medium text-brand-green-dark underline-offset-4 hover:underline"
        >
          Use a different email
        </Link>
      </div>
    </main>
  )
}
