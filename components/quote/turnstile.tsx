"use client";

import { useEffect } from "react";
import Script from "next/script";

type TurnstileApi = { reset: () => void };

/**
 * Cloudflare Turnstile widget (implicit rendering: it drops a `cf-turnstile-response` input into
 * the enclosing form). Only rendered when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Tokens are
 * single-use, so `resetKey` changing (a server response came back) requests a fresh one.
 */
export function Turnstile({ siteKey, resetKey }: { siteKey: string; resetKey: number }) {
  useEffect(() => {
    if (!resetKey) return;
    (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset();
  }, [resetKey]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div className="cf-turnstile min-h-[65px]" data-sitekey={siteKey} data-theme="light" />
    </>
  );
}
