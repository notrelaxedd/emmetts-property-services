/**
 * Client-side photo shrinking. Phone photos are 3-8 MB; Vercel rejects request bodies over about
 * 4.5 MB, so large JPEG/PNG/WebP files are re-encoded as ~2000px JPEGs before upload. Anything we
 * can't decode (e.g. HEIC outside Safari) is left untouched for the server to accept as is.
 */

const MAX_EDGE = 2000;
const SKIP_UNDER_BYTES = 900 * 1024;
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

async function shrink(file: File): Promise<File> {
  if (!SHRINKABLE.has(file.type) || file.size <= SKIP_UNDER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export async function shrinkPhotos(files: File[]): Promise<File[]> {
  return Promise.all(files.map(shrink));
}

/** Puts `files` back into a file input. Returns false if the browser can't (no DataTransfer). */
export function setInputFiles(input: HTMLInputElement, files: File[]): boolean {
  try {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    return true;
  } catch {
    return false;
  }
}
