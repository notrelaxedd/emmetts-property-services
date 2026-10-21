"use client"

import Link from "next/link"
import { useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { updatePassword } from "@/app/login/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
      {pending ? "Saving…" : "Save password"}
    </Button>
  )
}

export function PasswordForm({ home }: { home: string }) {
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

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

  return (
    <form action={async (fd) => setResult(await updatePassword(fd))} className="space-y-4">
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
