"use client"

import Link from "next/link"
import { useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { updatePassword, type UpdatePasswordResult } from "@/app/login/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
      {pending ? "Saving…" : "Save password"}
    </Button>
  )
}

/**
 * The server action reads the session from the cookies the browser sends with the form. If the
 * server sees no session (the sign-in link's session only ever reached the browser, or the cookie
 * went stale), try once more from the browser, which holds the same session in its own storage.
 */
async function save(fd: FormData): Promise<UpdatePasswordResult> {
  const result = await updatePassword(fd)
  if (result.ok || result.code !== "no-session") return result
  const password = String(fd.get("password") ?? "")
  try {
    const supabase = createSupabaseBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return result
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) return { ok: true }
    if (!/session missing/i.test(error.message)) return { ok: false, error: error.message, code: "other" }
  } catch {
    // fall through to the server's answer
  }
  return result
}

export function PasswordForm({ home }: { home: string }) {
  const [result, setResult] = useState<UpdatePasswordResult | null>(null)

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>Password saved. Sign in with it next time.</AlertDescription>
        </Alert>
        <Button asChild size="lg" className="h-11 w-full">
          <Link href={home}>{home === "/crew" ? "See my jobs" : "Continue"}</Link>
        </Button>
      </div>
    )
  }

  if (result && !result.ok && result.code === "no-session") {
    return (
      <div className="space-y-4">
        <Alert variant="warning">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            {result.error} Sign in again (a fresh sign-in link, or your password if you already have one) and you’ll land
            right back here. If the link keeps failing, ask Emmett to set a temporary password for you from the
            Employees page.
          </AlertDescription>
        </Alert>
        <Button asChild size="lg" className="h-11 w-full">
          <Link href={`/login?next=${encodeURIComponent("/account/password")}`}>Sign in again</Link>
        </Button>
      </div>
    )
  }

  return (
    <form action={async (fd) => setResult(await save(fd))} className="space-y-4">
      {result && !result.ok ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className="h-11" />
      </div>
      <Submit />
    </form>
  )
}
