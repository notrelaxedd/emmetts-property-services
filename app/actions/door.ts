"use server";

import { headers } from "next/headers";
import {
  doorAddress,
  doorFieldErrors,
  doorNote,
  doorPreferredDays,
  doorDayLabel,
  doorSchema,
  parseDoorFormData,
  type DoorFormState,
  type DoorFormValues,
} from "@/lib/door-schema";
import type { Lead } from "@/lib/db/types";
import { enqueueTask, upsertCustomer } from "@/lib/ops";
import { clientIpFrom, doorRateLimiter } from "@/lib/rate-limit";
import { localDate } from "@/lib/scheduler/time";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** The lead source for a booking made on `/door`. */
const DOOR_PAGE_SOURCE = "door";

const errorState = (message: string, values: DoorFormValues, fieldErrors = {}): DoorFormState => ({
  status: "error",
  nonce: Date.now(),
  message,
  fieldErrors,
  values,
});

/**
 * A rep books a homeowner at the door. Same path as the public quote form, so the job comes out the
 * same way: customer → lead (`source: door`, the picked weekday as the preferred day) → the quotes
 * worker prices it and puts the job on the "Needs a day" rail. The day the homeowner asked for goes
 * in the customer's notes (shown on the lead and customer pages) and the lead's utm. Nothing is sent
 * to the homeowner or the crew from here. Service role; Node runtime.
 */
export async function submitDoorBooking(_prev: DoorFormState, formData: FormData): Promise<DoorFormState> {
  const { values, honeypot } = parseDoorFormData(formData);

  // Bots fill the hidden field: pretend it worked, store nothing.
  if (honeypot.trim() !== "") return { status: "ok", nonce: Date.now(), summary: "Booked." };

  const parsed = doorSchema(localDate(new Date())).safeParse(values);
  if (!parsed.success) return errorState("Fix the highlighted fields.", values, doorFieldErrors(parsed.error));
  const data = parsed.data;

  const db = getSupabaseAdmin();
  if (!db) return errorState("Booking isn't set up right now. Text the job to Caden or Emmett instead.", values);

  if (!doorRateLimiter.hit(clientIpFrom(headers())).ok) {
    return errorState("Too many bookings in a few minutes. Wait a bit, or text the job to Caden or Emmett.", values);
  }

  try {
    const { data: rows, error } = await db.from("services").select("id, slug, name").eq("active", true).in("slug", data.services);
    if (error) throw new Error(`services lookup: ${error.message}`);
    // Keep the order the rep ticked them in.
    const picked = data.services
      .map((slug) => (rows ?? []).find((r) => r.slug === slug))
      .filter((r): r is { id: string; slug: string; name: string } => !!r);
    if (picked.length === 0) {
      return errorState("Fix the highlighted fields.", values, { services: "Those services aren't available right now." });
    }
    const names = picked.map((s) => s.name);

    const address = doorAddress(data);
    const note = doorNote(data, names);
    const customer = await upsertCustomer(db, { name: data.name, phone: data.phone, address });
    // upsertCustomer never overwrites existing notes, so add the booking line on top of what's there.
    const notes = customer.notes?.trim() ? `${note}\n${customer.notes.trim()}` : note;
    const { error: notesError } = await db.from("customers").update({ notes }).eq("id", customer.id);
    if (notesError) console.error(`[door] notes update failed (${customer.id}):`, notesError.message);

    const leadRow: Partial<Lead> = {
      customer_id: customer.id,
      source: DOOR_PAGE_SOURCE,
      utm: { source: DOOR_PAGE_SOURCE, medium: "rep", content: `wants ${data.date}` },
      requested_service_ids: picked.map((s) => s.id),
      custom_request: null,
      preferred_days: doorPreferredDays(data.date),
      photo_paths: [],
      status: "new",
      flyer_worker_id: null,
    };
    const { data: lead, error: leadError } = await db.from("leads").insert(leadRow).select("id").single();
    if (leadError || !lead) throw new Error(`lead insert: ${leadError?.message ?? "no row returned"}`);

    // Logged, not shown: the lead is saved and the owner sees it; a retry would only make a duplicate.
    try {
      await enqueueTask(db, { type: "quote", payload: { lead_id: lead.id }, dedupeKey: `quote:${lead.id}` });
    } catch (e) {
      console.error(`[door] enqueue failed for lead ${lead.id}:`, e instanceof Error ? e.message : e);
    }

    return {
      status: "ok",
      nonce: Date.now(),
      summary: `${data.name}, ${data.street}: ${names.join(", ")} on ${doorDayLabel(data.date)}.`,
    };
  } catch (e) {
    console.error("[door] booking failed:", e instanceof Error ? e.message : e);
    return errorState("That didn't save. Try again, or text the job to Caden or Emmett.", values);
  }
}
