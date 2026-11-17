import { NextResponse, type NextRequest } from "next/server";
import { processQuote } from "@/lib/quote-submit";

export const dynamic = "force-dynamic";
// Same budget as the server action: a geocode lookup plus up to 4 photos.
export const maxDuration = 60;

/**
 * Fallback for the quote form. The form posts here (multipart, the same fields) when its server
 * action request fails in the browser: a dropped connection, a server error, or a page loaded from
 * an older deployment. A plain route has no action id, so it can't go stale the way an action can.
 * Answers `{ status: "ok" }` (the form then opens /quote/thanks) or the same error state the action returns.
 */
export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error("[quote] fallback route: unreadable form body:", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "bad_request" }, { status: 400 });
  }
  const result = await processQuote(formData, "api");
  return NextResponse.json(result);
}
