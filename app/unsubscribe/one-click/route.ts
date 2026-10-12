import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeByToken } from "../unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe: mail clients POST `List-Unsubscribe=One-Click` to the URL in the
 * `List-Unsubscribe` header, e.g. `https://<site>/unsubscribe/one-click?token=<unsubscribe_token>`.
 * (The header written by lib/email currently points at the GET page, `/unsubscribe?token=`, which
 * works for the link in the email body; add the one-click URL plus `List-Unsubscribe-Post` there
 * to enable the mail clients' native unsubscribe button.)
 */
export async function POST(request: NextRequest) {
  const result = await unsubscribeByToken(request.nextUrl.searchParams.get("token"));
  if (result === "ok") return new NextResponse(null, { status: 200 });
  if (result === "not_found") return NextResponse.json({ error: "unknown token" }, { status: 404 });
  return NextResponse.json({ error: "try again later" }, { status: 503 });
}
