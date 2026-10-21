import { createPhotoUploads } from "@/app/actions/quote-photos";
import { sniffImageBytes, type PhotoType } from "@/lib/quote-schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Browser-direct photo upload. `createPhotoUploads` (server action) hands back one signed upload
 * URL per file; the bytes then go straight to Supabase Storage, never through a request body here.
 * Everything in this file is defensive: it never throws, and any failure is reported per file so
 * the form can offer a retry or fall back to sending the files with the form.
 */

const PHOTO_BUCKET = "lead-photos";
const UPLOAD_TIMEOUT_MS = 90_000;

export type DirectUploadResult = { status: "done"; path: string } | { status: "error"; error: string };

/** Image type from the file's real first bytes (names and MIME types can be missing or wrong). */
export async function sniffFileType(file: Blob): Promise<PhotoType | null> {
  try {
    return sniffImageBytes(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const NETWORK_ERROR = "Couldn't upload. Check your connection and try again.";

/**
 * Uploads `entries` (already shrunk, type already sniffed). Calls `onResult(index, result)` once
 * per entry as each finishes, and resolves when all have. Never rejects.
 */
export async function uploadPhotosDirect(
  entries: ReadonlyArray<{ file: File; type: PhotoType }>,
  onResult: (index: number, result: DirectUploadResult) => void,
): Promise<void> {
  const failAll = (error: string) => entries.forEach((_, i) => onResult(i, { status: "error", error }));

  let tickets: Array<{ path: string; token: string }>;
  try {
    const res = await createPhotoUploads({ files: entries.map((e) => ({ size: e.file.size, type: e.type })) });
    if (!res.ok) return failAll(res.error);
    if (res.uploads.length !== entries.length) return failAll(NETWORK_ERROR);
    tickets = res.uploads;
  } catch {
    return failAll(NETWORK_ERROR);
  }

  let bucket: ReturnType<ReturnType<typeof createSupabaseBrowserClient>["storage"]["from"]>;
  try {
    // Missing NEXT_PUBLIC_SUPABASE_* env makes this throw; treated like any other upload failure.
    bucket = createSupabaseBrowserClient().storage.from(PHOTO_BUCKET);
  } catch {
    return failAll(NETWORK_ERROR);
  }

  await Promise.all(
    entries.map(async ({ file, type }, i) => {
      const { path, token } = tickets[i];
      try {
        // storage-js sends a Blob/File as multipart and takes the part's Content-Type from the Blob
        // itself (the `contentType` option is ignored for Blobs). Re-wrap so the type is the sniffed
        // one even if the browser gave us a typeless "blob"; the bucket only accepts image types.
        const body = new Blob([file], { type });
        const { error } = await withTimeout(
          bucket.uploadToSignedUrl(path, token, body, { contentType: type }),
          UPLOAD_TIMEOUT_MS,
        );
        if (error) {
          console.warn("[quote] photo upload failed:", error.message);
          onResult(i, { status: "error", error: NETWORK_ERROR });
        } else {
          onResult(i, { status: "done", path });
        }
      } catch (e) {
        console.warn("[quote] photo upload failed:", e instanceof Error ? e.message : e);
        onResult(i, { status: "error", error: NETWORK_ERROR });
      }
    }),
  );
}
