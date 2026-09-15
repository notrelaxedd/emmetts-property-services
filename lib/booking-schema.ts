import { z } from "zod";
import { isServiceSlug } from "./services";
import { siteConfig } from "./site-config";

/** Today's date (YYYY-MM-DD) in the business's timezone, so "today" means the same thing everywhere. */
export function todayISO(timeZone: string = siteConfig.timezone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** "4408235545" → "(440) 823-5545". Leaves anything that isn't 10 digits alone. */
export function formatPhone(value: string): string {
  const d = phoneDigits(value);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : value.trim();
}

/** Shared by the client form (instant feedback) and the server action (the real gate). */
export const bookingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your name.")
    .max(100, "Please keep your name under 100 characters."),
  email: z
    .string()
    .trim()
    .min(1, "Please enter your email.")
    .max(254, "That email is too long.")
    .email("That email doesn't look quite right."),
  phone: z
    .string()
    .trim()
    .min(1, "Please enter a phone number so we can call you back.")
    .refine((v) => phoneDigits(v).length === 10, "Please enter a 10-digit phone number."),
  address: z
    .string()
    .trim()
    .min(5, "Please enter the street address for the job.")
    .max(200, "Please keep the address under 200 characters."),
  service: z.string().refine(isServiceSlug, "Please choose a service."),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please pick a date.")
    .refine((v) => v >= todayISO(), "Please pick today or a later date."),
  notes: z.string().trim().max(1000, "Please keep notes under 1,000 characters.").optional(),
  /** Honeypot. Hidden from people; bots that fill it get a quiet fake success. */
  company: z.string().optional(),
});

export type BookingInput = z.input<typeof bookingSchema>;
export type BookingData = z.output<typeof bookingSchema>;

export type BookingField = Exclude<keyof BookingInput, "company">;

export type BookingResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Partial<Record<BookingField, string>> };
