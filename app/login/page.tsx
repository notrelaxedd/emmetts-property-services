import type { Metadata } from "next"
import Image from "next/image"
import { LoginForm } from "./login-form"
import { safeNext } from "./redirects"

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
}

// Generic on purpose: nothing here says whether a given email or number has an account.
const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  password: "Wrong email or password. You can also email yourself a sign-in link below.",
  phone: "Enter a valid mobile number, including area code.",
  code: "That code didn’t work. Check it and try again, or request a new one.",
  rate: "Too many attempts. Please wait a minute and try again.",
  config: "Sign-in isn’t available right now. Please try again shortly.",
  link: "That sign-in link has expired or was already used. Request a new one below.",
  "no-access": "This account doesn’t have access yet. Ask Emmett to send you an invite.",
}

type SearchParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNext(one(searchParams.next)) ?? ""
  const tab = one(searchParams.tab) === "phone" ? "phone" : "email"
  const step = one(searchParams.step) === "code" ? "code" : "phone"
  const phone = (one(searchParams.phone) ?? "").slice(0, 20)
  const errorKey = one(searchParams.error)
  const error = errorKey ? (ERRORS[errorKey] ?? "Something went wrong. Please try again.") : null

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/logo.png" alt="Emmett’s Property Services" width={110} height={96} priority className="h-16 w-auto" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">Access is by invitation from the owner.</p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
          <LoginForm tab={tab} step={step} phone={phone} next={next} error={error} />
        </div>
      </div>
    </main>
  )
}
