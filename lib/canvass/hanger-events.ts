/**
 * Writes to `hanger_events` (QR scans and bookings per door-hanger code). Both helpers never throw: a scan must never
 * dead-end and a quote submission must never fail because attribution did. Server-side (service-role `Db`), no
 * next/* imports so the fake db can test it.
 */
import type { Db } from "../ops/types";
import { attributedHangerCode, normalizeHangerCode } from "./hangers";
import type { HangerAttribution } from "./hangers";

const logError = (what: string, e: unknown) => console.error(`[hanger] ${what}:`, e instanceof Error ? e.message : e);

/** The active hanger code row for a raw code, or null (unknown, inactive, malformed, or the db failed). */
export async function activeHangerCode(db: Db, raw: string | null | undefined): Promise<{ code: string; street: string } | null> {
  const code = normalizeHangerCode(raw);
  if (!code) return null;
  try {
    const { data, error } = await db.from("hanger_codes").select("code,street,active").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    return data && data.active ? { code: data.code, street: data.street } : null;
  } catch (e) {
    logError("code lookup failed", e);
    return null;
  }
}

/**
 * Record a QR scan for a code. `visitor` is the truncated sha256(ip|ua) (null when unknown). Returns true when a row
 * was written; false for an unknown / inactive code or a database error (logged).
 */
export async function recordHangerScan(db: Db, code: string, visitor: string | null, opts: { verified?: boolean } = {}): Promise<boolean> {
  const normalized = normalizeHangerCode(code);
  if (!normalized) return false;
  // `verified`: the caller already checked the code is active (saves a lookup on the hot path).
  const row = opts.verified ? { code: normalized } : await activeHangerCode(db, normalized);
  if (!row) return false;
  try {
    const { error } = await db.from("hanger_events").insert({ code: row.code, event: "scan", visitor, lead_id: null });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    logError("scan not recorded", e);
    return false;
  }
}

/**
 * Credit a quote-form lead to a hanger code: the `src=hanger&s=` / `utm_source=hanger&utm_campaign=` tags the QR
 * redirect added win, else the `hanger` cookie from an earlier scan. Returns the code credited, or null when the
 * submission had nothing to do with a hanger (or the write failed, which is logged, never thrown).
 */
export async function recordHangerBooking(
  db: Db,
  input: { utm: HangerAttribution | null | undefined; cookie: string | null | undefined; leadId: string },
): Promise<string | null> {
  const code = attributedHangerCode(input.utm ?? {}, input.cookie);
  if (!code) return null;
  try {
    // Bookings count even for a code the owner has since deactivated (the hanger was still on the door).
    const { data, error } = await db.from("hanger_codes").select("code").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { error: insertError } = await db.from("hanger_events").insert({ code: data.code, event: "booking", visitor: null, lead_id: input.leadId });
    if (insertError) throw new Error(insertError.message);
    return data.code;
  } catch (e) {
    logError("booking not recorded", e);
    return null;
  }
}
