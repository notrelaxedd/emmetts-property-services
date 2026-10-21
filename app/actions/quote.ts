"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { content } from "@/lib/content";
import { opsConfig } from "@/lib/config";
import type { Lead, Weekday } from "@/lib/db/types";
import { geocode } from "@/lib/geo";
import { enqueueTask, upsertCustomer } from "@/lib/ops";
import {
  PHOTO_EXT,
  fieldErrorsFrom,
  formatAddress,
  parseQuoteFormData,
  photoTypeOf,
  quoteSchema,
  type PhotoType,
  type QuoteFieldErrors,
  type QuoteFormState,
  type QuoteFormValues,
} from "@/lib/quote-schema";
import { clientIpFrom, quoteRateLimiter } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const copy = content.quote.errors;
const PHOTO_BUCKET = "lead-photos";

function errorState(
  message: string,
  values: QuoteFormValues,
  hadPhotos: boolean,
  fieldErrors: QuoteFieldErrors = {},
): QuoteFormState {
  return { status: "error", nonce: Date.now(), message, fieldErrors, values, hadPhotos };
}

/** Cloudflare Turnstile server-side check. Only called when TURNSTILE_SECRET_KEY is set. */
async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

/**
 * Image type from the first bytes alone. Some browsers submit re-encoded photos as a nameless
 * "blob" with no MIME type (seen on Windows Chrome), so the name and declared type can't be trusted.
 */
async function sniffImageType(file: File): Promise<PhotoType | null> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") return /^(heic|heix|hevc|hevx|mif1|msf1)/.test(ascii(8, 12)) ? "image/heic" : "image/heif";
  return null;
}

/** Do the file's first bytes look like the image type it claims to be? */
async function looksLikeImage(file: File, type: PhotoType): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/heic":
    case "image/heif":
      return ascii(4, 8) === "ftyp";
  }
}

/**
 * Public quote request. Honeypot, validation, per-IP rate limit and (optionally) Turnstile come
 * first; then customer -> lead -> photos -> fleet tasks. Redirects to /quote/thanks on success.
 * Needs the Node runtime (service-role Supabase client); do not mark this edge.
 */
export async function submitQuote(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  const { raw, values, files, honeypot } = parseQuoteFormData(formData);
  const hadPhotos = files.length > 0;

  // Bots fill the hidden field. Pretend it worked and store nothing.
  if (honeypot.trim() !== "") redirect("/quote/thanks");

  // Trust bytes over names: a photo may arrive as "blob" with an empty type. Resolve each file's
  // real type once here, and validate the metadata the schema sees with that resolved type.
  const sniffed = await Promise.all(files.map((f) => sniffImageType(f)));
  raw.photos = files.map((f, i) => ({
    name: f.name && f.name !== "blob" ? f.name : `photo-${i + 1}.${sniffed[i] ? PHOTO_EXT[sniffed[i]!] : "bin"}`,
    type: sniffed[i] ?? f.type,
    size: f.size,
  }));

  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) {
    return errorState(copy.fix, values, hadPhotos, fieldErrorsFrom(parsed.error));
  }
  const data = parsed.data;
  // One-line "123 Main St, Rocky River, OH 44116": stored on the customer and parsed by lib/stripe/tax.ts.
  const address = formatAddress(data);

  const db = getSupabaseAdmin();
  if (!db) return errorState(copy.unavailable, values, hadPhotos);

  const ip = clientIpFrom(headers());

  // Best-effort: serverless instances are ephemeral, so this is per warm instance (see lib/rate-limit.ts).
  if (!quoteRateLimiter.hit(ip).ok) return errorState(copy.rateLimited, values, hadPhotos);

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    const token = formData.get("cf-turnstile-response");
    if (!(await verifyTurnstile(turnstileSecret, typeof token === "string" ? token : "", ip))) {
      return errorState(copy.turnstile, values, hadPhotos);
    }
  }

  try {
    // Photos: re-validate by sniffing bytes (the client check is only a convenience).
    const photos: { file: File; type: PhotoType }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = sniffed[i] ?? photoTypeOf(file);
      if (!type || !(await looksLikeImage(file, type))) {
        return errorState(copy.fix, values, hadPhotos, {
          photos: `"${raw.photos[i]?.name ?? file.name}" isn't a photo we can use. Please add JPG, PNG, WebP, or HEIC images.`,
        });
      }
      photos.push({ file, type });
    }

    // Services arrive as slugs; leads store services.id.
    let serviceIds: string[] = [];
    if (data.services.length > 0) {
      const { data: rows, error } = await db
        .from("services")
        .select("id, slug")
        .eq("active", true)
        .in("slug", data.services);
      if (error) throw new Error(`services lookup: ${error.message}`);
      serviceIds = (rows ?? []).map((r) => r.id);
      if (serviceIds.length === 0 && data.customRequest === "") {
        return errorState(copy.fix, values, hadPhotos, {
          services: "That service isn't available right now. Please pick another.",
        });
      }
    }

    // Address -> lat/lng. Never blocks the request.
    // TODO [GEOCODER — ask owner]: address autocomplete plugs into the address input in
    // components/quote/address-autocomplete.tsx; this server-side lookup stays as the fallback.
    let coords: { lat: number; lng: number } | null = null;
    // Address autocomplete sends the picked place's coordinates; when valid, skip the geocode call.
    const rawLat = formData.get("lat");
    const rawLng = formData.get("lng");
    const lat = typeof rawLat === "string" && rawLat.trim() !== "" ? Number(rawLat) : NaN;
    const lng = typeof rawLng === "string" && rawLng.trim() !== "" ? Number(rawLng) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      coords = { lat, lng };
    }
    if (!coords && opsConfig.geocoder !== "none") {
      try {
        const hit = await Promise.race([
          geocode(address),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (hit) coords = { lat: hit.lat, lng: hit.lng };
      } catch (e) {
        console.error("[quote] geocode failed:", e instanceof Error ? e.message : e);
      }
    }

    const customer = await upsertCustomer(db, {
      name: data.name,
      email: data.email,
      phone: data.phone,
      address,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      email_opt_in: data.emailOptIn,
      sms_opt_in: data.smsOptIn,
      snow_list: data.snowList,
    });

    const leadRow: Partial<Lead> = {
      customer_id: customer.id,
      source: "web",
      utm: data.utm,
      requested_service_ids: serviceIds,
      custom_request: data.customRequest || null,
      preferred_days: data.preferredDays as Weekday[],
      photo_paths: [],
      status: "new",
    };
    const { data: lead, error: leadError } = await db.from("leads").insert(leadRow).select("id").single();
    if (leadError || !lead) throw new Error(`lead insert: ${leadError?.message ?? "no row returned"}`);

    // Photos live at leads/<leadId>/<n>.<ext> (n starts at 1) in the private `lead-photos` bucket.
    // A failed upload is logged and skipped: the lead is already saved and shouldn't be lost.
    const photoPaths: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const { file, type } = photos[i];
      const path = `leads/${lead.id}/${i + 1}.${PHOTO_EXT[type]}`;
      const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: type, upsert: false });
      if (error) {
        console.error(`[quote] photo upload failed (${path}):`, error.message);
        continue;
      }
      photoPaths.push(path);
    }
    if (photoPaths.length > 0) {
      const { error } = await db.from("leads").update({ photo_paths: photoPaths }).eq("id", lead.id);
      if (error) console.error(`[quote] photo_paths update failed (${lead.id}):`, error.message);
    }

    // Task failures are logged, not shown: the lead is saved and visible to the owner, and a
    // retry from the customer would only create a duplicate lead.
    try {
      await enqueueTask(db, { type: "quote", payload: { lead_id: lead.id }, dedupeKey: `quote:${lead.id}` });
      if (data.customRequest !== "" || photoPaths.length > 0) {
        await enqueueTask(db, {
          type: "custom_summary",
          payload: { lead_id: lead.id },
          dedupeKey: `custom_summary:${lead.id}`,
        });
      }
    } catch (e) {
      console.error(`[quote] enqueue failed for lead ${lead.id}:`, e instanceof Error ? e.message : e);
    }
  } catch (e) {
    console.error("[quote] submit failed:", e instanceof Error ? e.message : e);
    return errorState(copy.generic, values, hadPhotos);
  }

  redirect("/quote/thanks");
}
