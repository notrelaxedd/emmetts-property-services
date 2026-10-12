/** Pure phone helpers (US numbers). No I/O. */

/** Digits only, with a leading US country code `1` stripped from 11-digit numbers. */
export function normalizePhone(v: string | null | undefined): string {
  if (!v) return "";
  let d = v.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/** "4408235545" -> "(440) 823-5545". Anything that is not a 10-digit US number is returned trimmed. */
export function formatPhone(v: string | null | undefined): string {
  if (!v) return "";
  const d = normalizePhone(v);
  if (d.length !== 10) return v.trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
