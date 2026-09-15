"use server";

import { bookingSchema, formatPhone, type BookingField, type BookingResult } from "@/lib/booking-schema";
import { content } from "@/lib/content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function submitBooking(input: unknown): Promise<BookingResult> {
  // Honeypot filled in: almost certainly a bot. Pretend it worked and store nothing.
  if (input && typeof input === "object" && "company" in input && (input as { company?: unknown }).company) {
    return { ok: true };
  }

  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<BookingField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as BookingField | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ok: false, message: "Please fix the highlighted fields and try again.", fieldErrors };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("[booking] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; booking not saved.");
    return { ok: false, message: content.booking.errors.notConfigured };
  }

  const data = parsed.data;
  const { error } = await supabase.from("bookings").insert({
    name: data.name,
    email: data.email.toLowerCase(),
    phone: formatPhone(data.phone),
    address: data.address,
    service: data.service,
    preferred_date: data.preferredDate,
    notes: data.notes ? data.notes : null,
  });

  if (error) {
    console.error("[booking] Supabase insert failed:", error.message);
    return { ok: false, message: content.booking.errors.generic };
  }

  return { ok: true };
}
