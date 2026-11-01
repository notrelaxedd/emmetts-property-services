import { z } from "zod";
import { normalizePhone } from "./ops/phone";

/**
 * /door: the door-to-door booking form. One schema shared by the phone form (instant feedback) and
 * the server action (the real gate). Pure: no I/O, no next/* or server-only imports.
 */

/** The four things a rep can book, in the order they appear on the form. Keys are what's stored. */
export const DOOR_SERVICES = [
  { key: "leaves_front", label: "Leaves, front yard" },
  { key: "leaves_back", label: "Leaves, backyard" },
  { key: "mowing", label: "Mowing" },
  { key: "edging", label: "Edging" },
] as const;
export type DoorServiceKey = (typeof DOOR_SERVICES)[number]["key"];
export const DOOR_SERVICE_KEYS = DOOR_SERVICES.map((s) => s.key) as [DoorServiceKey, ...DoorServiceKey[]];

export function doorServiceLabel(key: string): string {
  return DOOR_SERVICES.find((s) => s.key === key)?.label ?? key;
}

/** Bookings are for Northeast Ohio, so "today" and "tomorrow" mean Ohio's calendar, wherever the server runs. */
export const DOOR_TIME_ZONE = "America/New_York";

/** How far ahead a rep can book. Anything past this is a mistyped year. */
export const MAX_DAYS_AHEAD = 366;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date (YYYY-MM-DD) in `timeZone` for the instant `now`. */
export function localIsoDate(now: Date, timeZone: string = DOOR_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `iso` plus `days` calendar days, as YYYY-MM-DD. Done in UTC so DST never shifts the day. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** True when `iso` is a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isRealIsoDate(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-11-08" -> "Saturday, Nov 8". Timezone-free: the date is a calendar day, not an instant. */
export function formatDoorDate(iso: string): string {
  if (!isRealIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Digits typed so far -> "(440) 555-1234", growing as they type. Never more than 10 digits. */
export function formatPhoneAsTyped(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return d.length === 3 ? `(${d}) ` : `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const doorCopy = {
  errors: {
    name: "Add their name",
    phone: "Add their phone number",
    phoneDigits: "Enter all 10 digits",
    address: "Add the street address",
    date: "Pick a day",
    datePast: "That day already passed",
    dateFar: "That day is too far out",
    services: "Pick at least one",
    failed: "That didn't go through. Try again.",
  },
} as const;

export type DoorField = "name" | "phone" | "address" | "date" | "services";
export type DoorFieldErrors = Partial<Record<DoorField, string>>;

/** What the form holds; exactly the five fields and nothing else. */
export type DoorFormValues = {
  name: string;
  /** As displayed: "(440) 555-1234". The schema reduces it to digits. */
  phone: string;
  address: string;
  /** YYYY-MM-DD from the native date input. */
  date: string;
  services: string[];
};

/**
 * Builds the schema for a given "today" (YYYY-MM-DD in Ohio), so a booking can't land on a day
 * that's already gone. Today itself is allowed: a rep can book a same-day job.
 */
export function doorSchema(today: string) {
  const latest = addDays(today, MAX_DAYS_AHEAD);
  return z.object({
    name: z.string().trim().min(1, doorCopy.errors.name).max(120, "Keep the name under 120 characters"),
    phone: z
      .string()
      .transform((v) => normalizePhone(v))
      .refine((d) => d.length > 0, doorCopy.errors.phone)
      .refine((d) => d.length === 0 || d.length === 10, doorCopy.errors.phoneDigits),
    address: z.string().trim().min(1, doorCopy.errors.address).max(200, "Keep the address under 200 characters"),
    date: z
      .string()
      .trim()
      .refine((v) => isRealIsoDate(v), doorCopy.errors.date)
      .refine((v) => !isRealIsoDate(v) || v >= today, doorCopy.errors.datePast)
      .refine((v) => !isRealIsoDate(v) || v <= latest, doorCopy.errors.dateFar),
    services: z
      .array(z.enum(DOOR_SERVICE_KEYS, { message: doorCopy.errors.services }))
      .min(1, doorCopy.errors.services)
      // Keep the form's order and drop any duplicate a double tap might send.
      .transform((keys) => DOOR_SERVICE_KEYS.filter((k) => keys.includes(k))),
  });
}
export type DoorBookingInput = z.infer<ReturnType<typeof doorSchema>>;

/** First message per field, in field order. */
export function doorFieldErrorsFrom(error: z.ZodError): DoorFieldErrors {
  const out: DoorFieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "") as DoorField;
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** The raw strings out of a FormData, for the schema. Unknown fields are ignored. */
export function parseDoorFormData(formData: FormData): { values: DoorFormValues; honeypot: string } {
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    values: {
      name: str("name"),
      phone: str("phone"),
      address: str("address"),
      date: str("date"),
      services: formData.getAll("services").filter((v): v is string => typeof v === "string"),
    },
    honeypot: str("company"),
  };
}

/** What the server action hands back. `booked` carries what the confirmation screen shows. */
export type DoorFormState =
  | { status: "idle" }
  | { status: "booked"; nonce: number; name: string; date: string; services: DoorServiceKey[] }
  | { status: "error"; nonce: number; message: string | null; fieldErrors: DoorFieldErrors };

export const initialDoorState: DoorFormState = { status: "idle" };
