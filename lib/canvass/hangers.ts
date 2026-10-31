/**
 * Door-hanger codes and QR attribution, one code per street. Pure (no next/* or db imports), mirroring
 * lib/flyers/codes.ts: the hanger's QR opens /h/<code>, which logs the scan, drops the `hanger` cookie and lands on
 * the quote form tagged src=hanger; the quote action then credits the booking to that street's code.
 */
import { normalizeCode, randomCode } from "../flyers/codes";
import type { HangerEventKind } from "../db/types";

export { CODE_ALPHABET } from "../flyers/codes";

/** Cookie that remembers the last hanger scanned, so a quote submitted days later still counts. */
export const HANGER_COOKIE = "hanger";
export const HANGER_COOKIE_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, in seconds

export const HANGER_UTM_SOURCE = "hanger";

/** A random 4-character code from the unambiguous alphabet. `random` returns integers in [0, n). */
export function randomHangerCode(random?: (n: number) => number): string {
  return randomCode(random);
}

/** " k7m2" -> "K7M2"; null unless it matches the `hanger_codes.code` check (4–8 letters / digits). */
export function normalizeHangerCode(raw: string | null | undefined): string | null {
  return normalizeCode(raw);
}

/** The URL printed in the QR: <site>/h/<code>. */
export function hangerUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/h/${encodeURIComponent(code)}`;
}

/** Where a scan lands: the quote form tagged for the hanger so the lead's utm records the street. */
export function hangerLandingPath(code: string): string {
  const c = encodeURIComponent(code);
  return `/quote?src=hanger&s=${c}&utm_source=hanger&utm_medium=qr&utm_campaign=${c}`;
}

export type HangerAttribution = {
  /** utm_source */
  source?: string | null;
  /** utm_campaign */
  campaign?: string | null;
  /** `src` query param the landing path adds. */
  src?: string | null;
  /** `s` query param (the code). */
  s?: string | null;
};

/**
 * The hanger code a quote-form submission is credited to: the tags the QR redirect added win (`src=hanger&s=` or
 * `utm_source=hanger&utm_campaign=`), otherwise the cookie from an earlier scan; null when neither names a code.
 */
export function attributedHangerCode(utm: HangerAttribution, cookie: string | null | undefined): string | null {
  if (utm.src?.toLowerCase() === HANGER_UTM_SOURCE) {
    const fromSrc = normalizeHangerCode(utm.s);
    if (fromSrc) return fromSrc;
  }
  if (utm.source?.toLowerCase() === HANGER_UTM_SOURCE) {
    const fromUtm = normalizeHangerCode(utm.campaign);
    if (fromUtm) return fromUtm;
  }
  return normalizeHangerCode(cookie);
}

// ---------- Conversions by street ----------

export type HangerCodeRow = { code: string; street: string };
export type HangerEventRow = { code: string; event: HangerEventKind; visitor: string | null };

export type HangerConversion = {
  code: string;
  street: string;
  /** Unique visitors who scanned (a scan without a visitor hash counts once). */
  scans: number;
  bookings: number;
  /** bookings ÷ scans; null until someone scans. */
  rate: number | null;
};

/** One row per code (= per street), sorted by street then code. Events for unknown codes are ignored. */
export function hangerConversions(codes: readonly HangerCodeRow[], events: readonly HangerEventRow[]): HangerConversion[] {
  type Acc = { street: string; visitors: Set<string>; anonymousScans: number; bookings: number };
  const acc = new Map<string, Acc>();
  for (const c of codes) {
    const code = normalizeHangerCode(c.code) ?? c.code;
    if (!acc.has(code)) acc.set(code, { street: c.street, visitors: new Set(), anonymousScans: 0, bookings: 0 });
  }
  for (const e of events) {
    const a = acc.get(normalizeHangerCode(e.code) ?? e.code);
    if (!a) continue;
    if (e.event === "booking") a.bookings++;
    else if (e.visitor) a.visitors.add(e.visitor);
    else a.anonymousScans++;
  }
  const out: HangerConversion[] = [];
  acc.forEach((a, code) => {
    const scans = a.visitors.size + a.anonymousScans;
    out.push({ code, street: a.street, scans, bookings: a.bookings, rate: scans > 0 ? a.bookings / scans : null });
  });
  return out.sort((x, y) => x.street.localeCompare(y.street) || x.code.localeCompare(y.code));
}

/** Every street together. */
export function totalHangerConversions(rows: readonly HangerConversion[]): Pick<HangerConversion, "scans" | "bookings" | "rate"> {
  let scans = 0;
  let bookings = 0;
  for (const r of rows) {
    scans += r.scans;
    bookings += r.bookings;
  }
  return { scans, bookings, rate: scans > 0 ? bookings / scans : null };
}
