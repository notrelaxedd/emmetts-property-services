"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { homeForCurrentUser, safeNext } from "./redirects"

/**
 * Sign-in is owner-invite only (`shouldCreateUser: false`). To avoid revealing whether an account
 * exists, a "no such user" failure looks exactly like success; only rate limits and missing config
 * (which say nothing about any particular account) are surfaced.
 */

function field(formData: FormData, name: string): string {
  const v = formData.get(name)
  return typeof v === "string" ? v.trim() : ""
}

function siteOrigin(): string {
  const h = headers()
  const origin = h.get("origin")
  if (origin) return origin
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`
  return "http://localhost:3000"
}

function isRateLimit(error: { status?: number; code?: string; message?: string }): boolean {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_sms_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    /rate limit|security purposes/i.test(error.message ?? "")
  )
}

function loginUrl(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `/login?${s}` : "/login"
}

/** "(440) 555-0100" -> "+14405550100". Returns null if it doesn't look like a phone number. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "")
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return null
}

export async function sendMagicLink(formData: FormData) {
  const email = field(formData, "email").toLowerCase()
  const next = safeNext(field(formData, "next"))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(loginUrl({ error: "email", next }))

  const supabase = createSupabaseServerClient()
  if (!supabase) redirect(loginUrl({ error: "config", next }))

  const callback = new URL("/api/auth/callback", siteOrigin())
  if (next) callback.searchParams.set("next", next)

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: false },
  })
  if (error) console.warn("[login] magic link request failed", { status: error.status, code: error.code, message: error.message })
  if (error && isRateLimit(error)) redirect(loginUrl({ error: "rate", next }))

  redirect(`/login/check-email?${new URLSearchParams({ email, ...(next ? { next } : {}) }).toString()}`)
}

/** Email + password sign-in. Wrong email and wrong password give the same generic error. */
export async function signInWithPassword(formData: FormData) {
  const email = field(formData, "email").toLowerCase()
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : ""
  const next = safeNext(field(formData, "next"))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(loginUrl({ error: "email", next }))
  if (password.length < 8) redirect(loginUrl({ error: "password", next }))

  const supabase = createSupabaseServerClient()
  if (!supabase) redirect(loginUrl({ error: "config", next }))

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Operational detail only (no credentials): shows up in Vercel's function logs.
    console.warn("[login] password sign-in failed", { status: error.status, code: error.code, message: error.message })
    redirect(loginUrl({ error: isRateLimit(error) ? "rate" : "password", next }))
  }

  const home = await homeForCurrentUser(supabase)
  if (!home) {
    await supabase.auth.signOut()
    redirect(loginUrl({ error: "no-access" }))
  }
  redirect(next ?? home)
}

const NO_SESSION_MESSAGE = "Your sign-in from the link has expired, so the password couldn’t be saved."

export type UpdatePasswordResult =
  | { ok: true }
  | { ok: false; error: string; code?: "no-session" | "weak" | "other" }

function isSessionMissing(error: { message?: string; name?: string; status?: number }): boolean {
  return error.name === "AuthSessionMissingError" || /session missing|not logged in|JWT|invalid claim/i.test(error.message ?? "")
}

/**
 * Signed-in users set or change their password at /account/password. Reads the session from the
 * cookie the browser sent with the form; the form falls back to the browser client when there is
 * no session on this side, and failures are logged so Vercel's function log shows what happened.
 */
export async function updatePassword(formData: FormData): Promise<UpdatePasswordResult> {
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : ""
  const confirm = typeof formData.get("confirm") === "string" ? (formData.get("confirm") as string) : ""
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters.", code: "weak" }
  if (password !== confirm) return { ok: false, error: "The two passwords don’t match.", code: "weak" }
  const supabase = createSupabaseServerClient()
  if (!supabase) return { ok: false, error: "Sign-in isn’t available right now.", code: "other" }

  const hasAuthCookie = cookies().getAll().some((c) => /-auth-token/.test(c.name))
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (!user) {
    console.warn("[account] password update: no server session", {
      hasAuthCookie,
      code: userError?.code,
      status: userError?.status,
      message: userError?.message,
    })
    return { ok: false, code: "no-session", error: NO_SESSION_MESSAGE }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.warn("[account] password update failed", { userId: user.id, code: error.code, status: error.status, message: error.message })
    if (isSessionMissing(error)) return { ok: false, code: "no-session", error: NO_SESSION_MESSAGE }
    return { ok: false, code: "other", error: error.message }
  }
  return { ok: true }
}

export async function sendPhoneOtp(formData: FormData) {
  const phone = normalizePhone(field(formData, "phone"))
  const next = safeNext(field(formData, "next"))
  if (!phone) redirect(loginUrl({ tab: "phone", error: "phone", next }))

  const supabase = createSupabaseServerClient()
  if (!supabase) redirect(loginUrl({ tab: "phone", error: "config", next }))

  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
  if (error && isRateLimit(error)) redirect(loginUrl({ tab: "phone", error: "rate", next }))

  redirect(loginUrl({ tab: "phone", step: "code", phone, next }))
}

export async function verifyPhoneOtp(formData: FormData) {
  const phone = normalizePhone(field(formData, "phone"))
  const token = field(formData, "token").replace(/\s/g, "")
  const next = safeNext(field(formData, "next"))
  if (!phone) redirect(loginUrl({ tab: "phone", error: "phone", next }))
  if (!/^\d{4,8}$/.test(token)) redirect(loginUrl({ tab: "phone", step: "code", phone, error: "code", next }))

  const supabase = createSupabaseServerClient()
  if (!supabase) redirect(loginUrl({ tab: "phone", error: "config", next }))

  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" })
  if (error) {
    redirect(
      loginUrl({ tab: "phone", step: "code", phone, error: isRateLimit(error) ? "rate" : "code", next })
    )
  }

  const home = await homeForCurrentUser(supabase)
  if (!home) {
    await supabase.auth.signOut()
    redirect(loginUrl({ error: "no-access" }))
  }
  redirect(next ?? home)
}

export async function signOut() {
  const supabase = createSupabaseServerClient()
  if (supabase) await supabase.auth.signOut()
  redirect("/login")
}
