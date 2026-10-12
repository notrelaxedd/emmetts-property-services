"use client"

import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { useFormStatus } from "react-dom"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { sendMagicLink, sendPhoneOtp, verifyPhoneOtp } from "./actions"

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  )
}

export function LoginForm({
  tab,
  step,
  phone,
  next,
  error,
}: {
  tab: "email" | "phone"
  step: "phone" | "code"
  phone: string
  next: string
  error: string | null
}) {
  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue={tab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="phone">Phone</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="mt-4">
          <form action={sendMagicLink} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="you@example.com"
                className="h-11"
              />
            </div>
            <Submit>Email me a sign-in link</Submit>
          </form>
        </TabsContent>

        <TabsContent value="phone" className="mt-4">
          {step === "code" ? (
            <form action={verifyPhoneOtp} className="space-y-4">
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="phone" value={phone} />
              <div className="space-y-1.5">
                <Label htmlFor="token">Code</Label>
                <Input
                  id="token"
                  name="token"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  autoFocus
                  placeholder="123456"
                  className="h-11 text-center text-lg tracking-[0.3em]"
                />
                <p className="text-sm text-ink-muted">If {phone || "that number"} is on the crew list, a text is on its way.</p>
              </div>
              <Submit>Sign in</Submit>
              <Button asChild variant="link" className="w-full">
                <Link href={`/login?tab=phone${next ? `&next=${encodeURIComponent(next)}` : ""}`}>Use a different number</Link>
              </Button>
            </form>
          ) : (
            <form action={sendPhoneOtp} className="space-y-4">
              <input type="hidden" name="next" value={next} />
              <div className="space-y-1.5">
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  placeholder="(440) 555-0100"
                  className="h-11"
                />
              </div>
              <Submit>Text me a code</Submit>
            </form>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
