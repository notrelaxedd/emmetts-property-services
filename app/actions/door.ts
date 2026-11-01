"use server";

import { headers } from "next/headers";
import {
  doorCopy,
  doorFieldErrorsFrom,
  doorSchema,
  localIsoDate,
  parseDoorFormData,
  type DoorFormState,
} from "@/lib/door-schema";
import { clientIpFrom, doorRateLimiter } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * /door: a rep books a job on the porch. Honeypot and validation first (the browser's checks are
 * only a convenience), then one row in `door_bookings`. Nothing else is created or sent.
 * Needs the Node runtime (service-role Supabase client); do not mark this edge.
 */
export async function bookDoorJob(formData: FormData): Promise<DoorFormState> {
  const nonce = Date.now();
  const { values, honeypot } = parseDoorFormData(formData);
  const today = localIsoDate(new Date());

  const parsed = doorSchema(today).safeParse(values);
  if (!parsed.success) {
    return { status: "error", nonce, message: null, fieldErrors: doorFieldErrorsFrom(parsed.error) };
  }
  const data = parsed.data;

  // Bots fill the hidden field. Pretend it worked and store nothing.
  if (honeypot.trim() !== "") {
    return { status: "booked", nonce, name: data.name, date: data.date, services: data.services };
  }

  // Best-effort and generous: reps share carrier IPs, so this only catches a runaway script.
  if (!doorRateLimiter.hit(clientIpFrom(headers())).ok) {
    return { status: "error", nonce, message: doorCopy.errors.failed, fieldErrors: {} };
  }

  const db = getSupabaseAdmin();
  if (!db) {
    console.error("[door] Supabase is not configured; booking not saved");
    return { status: "error", nonce, message: doorCopy.errors.failed, fieldErrors: {} };
  }

  const { error } = await db.from("door_bookings").insert({
    name: data.name,
    phone: data.phone,
    address: data.address,
    job_date: data.date,
    services: data.services,
  });
  if (error) {
    console.error("[door] insert failed:", error.message);
    return { status: "error", nonce, message: doorCopy.errors.failed, fieldErrors: {} };
  }

  return { status: "booked", nonce, name: data.name, date: data.date, services: data.services };
}
