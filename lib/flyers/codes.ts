/**
 * Flyer worker codes and QR attribution. Pure (no next/* or db imports) so it's unit-testable.
 *
 * Each flyer worker has a short code (e.g. "K7M2"). Their QR code opens /f/<code>, which logs the
 * scan, remembers the code in a cookie and lands on the quote form with utm_source=flyer. The quote
 * action then tags the lead with that worker.
 */

/** No 0/O, 1/I/L: the code is printed on the flyer and may be read out over the phone. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

/** Cookie that remembers the last flyer scanned, so a lead submitted days later still counts. */
export const FLYER_COOKIE = "flyer";
export const FLYER_COOKIE_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, in seconds

/** Pay per flyer for new workers. */
export const DEFAULT_RATE_PER_FLYER = 0.1;

/** A random code. `random` returns integers in [0, n); defaults to crypto randomness. */
export function randomCode(random: (n: number) => number = cryptoInt): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

function cryptoInt(n: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % n;
}

/** "k7m2 " -> "K7M2"; null unless it looks like a code (4–8 letters / digits). */
export function normalizeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
}

/** Where a QR scan lands: the quote form, tagged so the lead (and leads.utm) records the flyer. */
export function flyerLandingPath(code: string): string {
  return `/quote?utm_source=flyer&utm_medium=qr&utm_campaign=${encodeURIComponent(code)}`;
}

/** The URL encoded in a worker's QR code. */
export function flyerUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, "")}/f/${code}`;
}

/**
 * The flyer code a quote-form submission should be credited to: the utm tags the QR redirect adds
 * win (that visit came straight from a flyer); otherwise the cookie from an earlier scan.
 */
export function attributedCode(utm: { source?: string; campaign?: string }, cookie: string | null | undefined): string | null {
  if (utm.source?.toLowerCase() === "flyer") {
    const fromUtm = normalizeCode(utm.campaign);
    if (fromUtm) return fromUtm;
  }
  return normalizeCode(cookie);
}

/** Link-preview fetchers and crawlers: their "scans" aren't people. */
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|curl|wget/i.test(userAgent);
}
