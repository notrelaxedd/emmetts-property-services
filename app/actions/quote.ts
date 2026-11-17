"use server";

import { redirect } from "next/navigation";
import type { QuoteFormState } from "@/lib/quote-schema";
import { processQuote } from "@/lib/quote-submit";

/**
 * The quote form's server action. The work is in `processQuote` (lib/quote-submit.ts), shared with
 * the `/api/quote` fallback route.
 *
 * With JavaScript the form calls this itself and sends `_js=1`: success comes back as `{ status: "ok" }`
 * (not a redirect) so the form can tell it apart from a failed request. Next 14 resolves a failed
 * action call with `undefined` too, and the form then retries through `/api/quote`. Without
 * JavaScript the browser posts the form natively and success redirects to the thanks page.
 */
export async function submitQuote(
  _prev: QuoteFormState | { status: "ok" },
  formData: FormData,
): Promise<QuoteFormState | { status: "ok" }> {
  const result = await processQuote(formData, "action");
  if (result.status === "ok") {
    if (formData.get("_js") === "1") return result;
    redirect("/quote/thanks");
  }
  return result;
}
