/**
 * The hidden door-to-door booking page (`/door`): what a rep types at the door, and its checks.
 * Only what the rep needs: their own name, homeowner name, phone, address, the day they want, and the services.
 * Pure: no I/O, no next/* or server-only imports (unit-tested in door-schema.test.ts).
 */
import { z } from "zod";
import type { Weekday } from "./db/types";
import { normalizePhone } from "./ops/phone";
import { addDays, weekdayOf } from "./scheduler/time";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How far ahead a rep can book. */
export const DOOR_MAX_DAYS_AHEAD = 120;
/** The town filled in by default (most doors are here). */
export const DOOR_DEFAULT_CITY = "Rocky River";

/** `today` is the business-timezone "YYYY-MM-DD" (passed in so the schema stays pure). */
export function doorSchema(today: string) {
  const last = addDays(today, DOOR_MAX_DAYS_AHEAD);
  return z
    .object({
    /** The rep's own name, so the owner can see who got the lead. */
    rep: z.string().trim().min(2, "Enter your name.").max(60, "Keep your name under 60 characters."),
    name: z.string().trim().min(2, "Enter the homeowner's name.").max(100, "Keep the name under 100 characters."),
    phone: z
      .string()
      .trim()
      .min(1, "Enter the homeowner's phone number.")
      .refine((v) => normalizePhone(v).length === 10, "Enter a 10-digit phone number.")
      .transform((v) => normalizePhone(v)),
    street: z.string().trim().min(3, "Enter the street address.").max(120, "Keep the street address under 120 characters."),
    city: z.string().trim().min(2, "Enter the town.").max(60, "Keep the town under 60 characters."),
    date: z
      .string()
      .trim()
      .regex(DATE_RE, "Pick the day they want.")
      .refine((d) => d >= today, "That day has already passed.")
      .refine((d) => d <= last, `Pick a day within the next ${DOOR_MAX_DAYS_AHEAD} days.`),
    services: z
      .array(z.string().regex(SLUG_RE, "That service isn't available."))
      .max(20)
      .transform((s) => Array.from(new Set(s))),
    /** "Other": anything not on the list, in the rep's words. Becomes the lead's custom request (needs your price). */
    other: z.string().trim().max(500, "Keep it under 500 characters.").default(""),
  })
    .superRefine((d, ctx) => {
      if (d.services.length === 0 && d.other === "") {
        ctx.addIssue({ code: "custom", path: ["services"], message: "Tick a service, or write what they want under Other." });
      }
    });
}

export type DoorData = z.output<ReturnType<typeof doorSchema>>;
export type DoorField = "rep" | "name" | "phone" | "street" | "city" | "date" | "services" | "other";
export type DoorFieldErrors = Partial<Record<DoorField, string>>;

export type DoorFormValues = { rep: string; name: string; phone: string; street: string; city: string; date: string; services: string[]; other: string };

export type DoorFormState =
  | { status: "idle" }
  | { status: "error"; nonce: number; message: string; fieldErrors: DoorFieldErrors; values: DoorFormValues }
  | { status: "ok"; nonce: number; summary: string };

export const initialDoorState: DoorFormState = { status: "idle" };

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function parseDoorFormData(fd: FormData): { values: DoorFormValues; honeypot: string } {
  return {
    values: {
      rep: str(fd, "rep"),
      name: str(fd, "name"),
      phone: str(fd, "phone"),
      street: str(fd, "street"),
      city: str(fd, "city"),
      date: str(fd, "date"),
      services: fd.getAll("services").filter((v): v is string => typeof v === "string"),
      other: str(fd, "other"),
    },
    honeypot: str(fd, "company"),
  };
}

export function doorFieldErrors(error: z.ZodError): DoorFieldErrors {
  const out: DoorFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as DoorField | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

/** ZIP codes of the towns we serve, so a door booking's address is complete (Stripe Tax needs the ZIP). */
export const DOOR_TOWN_ZIPS: Readonly<Record<string, string>> = {
  "rocky river": "44116",
  westlake: "44145",
  "bay village": "44140",
  lakewood: "44107",
};

/** One-line address as stored on the customer: "123 Main St, Rocky River, OH 44116" (no ZIP for other towns). */
export function doorAddress(d: Pick<DoorData, "street" | "city">): string {
  const zip = DOOR_TOWN_ZIPS[d.city.trim().toLowerCase()];
  return zip ? `${d.street}, ${d.city}, OH ${zip}` : `${d.street}, ${d.city}, OH`;
}

/** "Sat, Nov 14" for a local "YYYY-MM-DD". */
export function doorDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The weekday the homeowner picked, as the lead's preferred day. */
export function doorPreferredDays(date: string): Weekday[] {
  return [weekdayOf(date) as Weekday];
}

/** What they want, for the notes and the rep's confirmation: the ticked services, then "Other: …". */
export function doorWants(serviceNames: string[], other: string): string {
  return [...serviceNames, ...(other ? [`Other: ${other}`] : [])].join(", ");
}

/** The line added to the customer's notes, so the day they asked for shows on the lead and customer pages. */
export function doorNote(d: Pick<DoorData, "rep" | "date" | "street" | "city" | "other">, serviceNames: string[]): string {
  return `Door booking by ${d.rep}: wants ${doorDayLabel(d.date)} (${d.date}) for ${doorWants(serviceNames, d.other)} at ${doorAddress(d)}.`;
}
