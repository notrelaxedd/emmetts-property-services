import { NextResponse, type NextRequest } from "next/server"
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 })
const MAX = 2000

const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX) : "")

/**
 * Browser-side crashes land here from the error boundaries (app/error.tsx, app/admin/error.tsx, …) so they
 * show up in the Vercel runtime logs next to server errors. Nothing is stored; it only logs.
 */
export async function POST(request: NextRequest) {
  if (!limiter.hit(clientIpFrom(request.headers)).ok) return new NextResponse(null, { status: 429 })
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  console.error("[client] exception", {
    message: clip(body.message),
    digest: clip(body.digest),
    url: clip(body.url),
    stack: clip(body.stack),
    ua: request.headers.get("user-agent")?.slice(0, 200) ?? "",
  })
  return new NextResponse(null, { status: 204 })
}
