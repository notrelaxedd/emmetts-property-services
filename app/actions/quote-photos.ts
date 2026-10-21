"use server";

import { headers } from "next/headers";
import { content } from "@/lib/content";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_EXT, type PhotoType } from "@/lib/quote-schema";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const PHOTO_BUCKET = "lead-photos";

// TODO: clean pending/ older than 1 day. Objects at pending/<batch>/ that no lead ever claimed
// (abandoned forms) are private and harmless, but they do take up space.

/** Separate from the submit limiter: one quote = one batch, plus retries and re-picks. 40 per 10 minutes per IP. */
const uploadRateLimiter = createRateLimiter({ limit: 40, windowMs: 10 * 60 * 1000 });

export type PhotoUploadTicket = { path: string; token: string; signedUrl: string };

export type CreatePhotoUploadsResult =
  | { ok: true; batch: string; uploads: PhotoUploadTicket[] }
  | { ok: false; error: string };

const fail = (error: string): CreatePhotoUploadsResult => ({ ok: false, error });

/**
 * Step 1 of a browser-direct photo upload. Validates what the browser says it is about to send
 * (count, size, type) and returns one signed upload URL per file, each good for exactly one path
 * under `pending/<batch>/`. The bytes then go straight from the browser to Supabase Storage, so
 * they never pass through a request body here. `submitQuote` re-checks the real bytes before it
 * moves a file to `leads/<leadId>/`, so the declared type is only used to pick the extension.
 * Service-role client: do not call from anywhere that is not a server action.
 */
export async function createPhotoUploads(input: {
  files: Array<{ size: number; type: string }>;
}): Promise<CreatePhotoUploadsResult> {
  // Server actions are public POST endpoints: treat the argument as unknown.
  const files: unknown = (input as { files?: unknown } | null | undefined)?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PHOTOS) {
    return fail(`Please add up to ${MAX_PHOTOS} photos.`);
  }
  const types: PhotoType[] = [];
  for (const f of files as Array<{ size?: unknown; type?: unknown } | null>) {
    const size = f?.size;
    const type = typeof f?.type === "string" ? f.type.toLowerCase() : "";
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) {
      return fail("One of your photos is empty or too large. Photos can be up to 8 MB each.");
    }
    if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(type)) {
      return fail("One of your photos isn't a type we can use. Please add JPG, PNG, WebP, or HEIC images.");
    }
    types.push(type as PhotoType);
  }

  const ip = clientIpFrom(headers());
  if (!uploadRateLimiter.hit(`photos:${ip}`).ok) return fail(content.quote.errors.rateLimited);

  const db = getSupabaseAdmin();
  if (!db) return fail(content.quote.errors.unavailable);

  const batch = crypto.randomUUID();
  const uploads: PhotoUploadTicket[] = [];
  try {
    for (let i = 0; i < types.length; i++) {
      const path = `pending/${batch}/${i + 1}.${PHOTO_EXT[types[i]]}`;
      const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
      if (error || !data) {
        console.error(`[quote-photos] signed upload url failed (${path}):`, error?.message ?? "no data");
        return fail(content.quote.errors.generic);
      }
      uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
    }
  } catch (e) {
    console.error("[quote-photos] createPhotoUploads failed:", e instanceof Error ? e.message : e);
    return fail(content.quote.errors.generic);
  }
  return { ok: true, batch, uploads };
}
