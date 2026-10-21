import { z } from "zod";
import type { Weekday } from "./db/types";
import { normalizePhone } from "./ops/phone";

/**
 * Public quote form: one schema shared by the client form (instant feedback) and the server
 * action (the real gate). Pure: no I/O, no next/* or server-only imports.
 */

export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_PHOTO_MB = MAX_PHOTO_BYTES / (1024 * 1024);
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type PhotoType = (typeof ALLOWED_PHOTO_TYPES)[number];

const EXT_TO_TYPE: Record<string, PhotoType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** Storage file extension for a validated photo type. */
export const PHOTO_EXT: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * Best-effort image type from a file's declared MIME type, falling back to its extension (iOS and
 * some Android browsers send HEIC with an empty type). Returns null for anything we don't accept.
 */
export function photoTypeOf(file: { name: string; type: string }): PhotoType | null {
  const declared = file.type.toLowerCase();
  if ((ALLOWED_PHOTO_TYPES as readonly string[]).includes(declared)) return declared as PhotoType;
  if (declared && declared !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_TYPE[ext] ?? null;
}

/**
 * Image type from a file's first bytes alone (pass at least the first 12). Browsers sometimes hand
 * over photos with no name or MIME type, and clients can lie, so the server decides by content.
 */
export function sniffImageBytes(b: Uint8Array): PhotoType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") return /^(heic|heix|hevc|hevx|mif1|msf1)/.test(ascii(8, 12)) ? "image/heic" : "image/heif";
  return null;
}

/**
 * Where a browser-direct upload lands before the lead exists: `pending/<batch uuid>/<n>.<ext>` in
 * the private `lead-photos` bucket. Only paths `createPhotoUploads` could have issued are accepted
 * by `submitQuote`, which then moves them to `leads/<leadId>/<n>.<ext>`.
 */
export const PENDING_PHOTO_PATH_RE =
  /^pending\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-4]\.(jpg|png|webp|heic|heif)$/;

export function isPendingPhotoPath(path: string): boolean {
  return PENDING_PHOTO_PATH_RE.test(path);
}

/** `pending/<batch>/2.jpg` -> `{ dir: "pending/<batch>", name: "2.jpg" }`. */
export function splitPhotoPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export type PhotoMeta = { name: string; type: string; size: number };

/** Human-readable problem with a set of photos, or null when they're fine. Empty list is fine. */
export function photoError(photos: readonly PhotoMeta[]): string | null {
  if (photos.length > MAX_PHOTOS) return `Please add up to ${MAX_PHOTOS} photos.`;
  for (const p of photos) {
    if (p.size > MAX_PHOTO_BYTES) return `"${p.name}" is over ${MAX_PHOTO_MB} MB. Please pick a smaller photo.`;
    if (photoTypeOf(p) === null) return `"${p.name}" isn't a photo we can use. Please add JPG, PNG, WebP, or HEIC images.`;
  }
  return null;
}

export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: Weekday; label: string; short: string }> = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const quoteSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name.").max(100, "Please keep your name under 100 characters."),
    email: z
      .string()
      .trim()
      .min(1, "Please enter your email.")
      .max(254, "That email is too long.")
      .pipe(z.email("That email doesn't look quite right.")),
    /** Stored as 10 digits (US). Accepts "(440) 823-5545", "440-823-5545", "+1 440 823 5545", etc. */
    phone: z
      .string()
      .trim()
      .min(1, "Please enter a phone number so we can reach you.")
      .refine((v) => normalizePhone(v).length === 10, "Please enter a 10-digit phone number.")
      .transform((v) => normalizePhone(v)),
    /** Street line only; city/state/ZIP are separate fields. See `formatAddress` for the stored form. */
    street: z
      .string()
      .trim()
      .min(3, "Please enter the street address for the job.")
      .max(120, "Please keep the street address under 120 characters."),
    city: z
      .string()
      .trim()
      .min(2, "Please enter the city.")
      .max(60, "Please keep the city under 60 characters."),
    /** Two-letter state, uppercased ("oh" -> "OH"). */
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Please enter a 2-letter state, like OH."),
    /** 5 digits, or ZIP+4 ("12345-6789"). */
    zip: z
      .string()
      .trim()
      // "44116", "44116-1234", or "441161234" (normalised to the hyphenated form).
      .transform((v) => (/^\d{9}$/.test(v) ? `${v.slice(0, 5)}-${v.slice(5)}` : v))
      .refine((v) => /^\d{5}(-\d{4})?$/.test(v), "Please enter a 5-digit ZIP code."),
    /** services.slug values. */
    services: z
      .array(z.string().regex(SLUG_RE, "That service isn't available."))
      .max(20)
      .default([]),
    customRequest: z.string().trim().max(1500, "Please keep this under 1,500 characters.").default(""),
    preferredDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .default([])
      .transform((days) => Array.from(new Set(days)).sort((a, b) => a - b) as Weekday[]),
    emailOptIn: z.boolean().default(false),
    smsOptIn: z.boolean().default(false),
    snowList: z.boolean().default(false),
    photos: z
      .array(z.object({ name: z.string(), type: z.string(), size: z.number() }))
      .default([])
      .superRefine((photos, ctx) => {
        const msg = photoError(photos);
        if (msg) ctx.addIssue({ code: "custom", message: msg });
      }),
    /** Storage paths of photos the browser already uploaded (hidden `photo_paths` inputs). */
    photoPaths: z
      .array(z.string())
      .default([])
      .superRefine((paths, ctx) => {
        if (paths.length > MAX_PHOTOS) {
          ctx.addIssue({ code: "custom", message: `Please add up to ${MAX_PHOTOS} photos.` });
        } else if (!paths.every(isPendingPhotoPath) || new Set(paths).size !== paths.length) {
          ctx.addIssue({ code: "custom", message: "One of your photos didn't upload properly. Please add your photos again." });
        }
      }),
    utm: z
      .object({
        source: z.string().max(200).optional(),
        medium: z.string().max(200).optional(),
        campaign: z.string().max(200).optional(),
        content: z.string().max(200).optional(),
        term: z.string().max(200).optional(),
      })
      .default({}),
  })
  .superRefine((v, ctx) => {
    if (v.photos.length + v.photoPaths.length > MAX_PHOTOS) {
      ctx.addIssue({ code: "custom", path: ["photos"], message: `Please add up to ${MAX_PHOTOS} photos.` });
    }
    if (v.services.length === 0 && v.customRequest.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["services"],
        message: "Pick at least one service, or tell us what you need in the box below.",
      });
    }
  });

export type QuoteInput = z.input<typeof quoteSchema>;
export type QuoteData = z.output<typeof quoteSchema>;
export type QuoteField =
  | "name"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "services"
  | "customRequest"
  | "photos"
  | "preferredDays";
export type QuoteFieldErrors = Partial<Record<QuoteField, string>>;

/**
 * The one-line address stored in `customers.address` (and geocoded / parsed by `lib/stripe/tax.ts`
 * `parseUsAddress`): "123 Main St, Rocky River, OH 44116". Pass schema output (already trimmed).
 */
export function formatAddress(a: { street: string; city: string; state: string; zip: string }): string {
  return `${a.street.trim()}, ${a.city.trim()}, ${a.state.trim().toUpperCase()} ${a.zip.trim()}`;
}

/** First message per top-level field, for inline display. */
export function fieldErrorsFrom(error: z.ZodError): QuoteFieldErrors {
  const out: QuoteFieldErrors = {};
  for (const issue of error.issues) {
    const first = String(issue.path[0] ?? "");
    const key = (first === "photoPaths" ? "photos" : first) as QuoteField;
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** What the form echoes back to the user after a failed submit so nothing they typed is lost. */
export type QuoteFormValues = {
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  services: string[];
  customRequest: string;
  preferredDays: number[];
  emailOptIn: boolean;
  smsOptIn: boolean;
  snowList: boolean;
};

export type QuoteFormState =
  | { status: "idle" }
  | {
      status: "error";
      /** Changes on every response so the form can re-seed its inputs from `values`. */
      nonce: number;
      message: string;
      fieldErrors: QuoteFieldErrors;
      values: QuoteFormValues;
      /** True when the user had photos attached (file inputs can't be refilled, so ask again). */
      hadPhotos: boolean;
    };

export const initialQuoteState: QuoteFormState = { status: "idle" };

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const checked = (fd: FormData, key: string): boolean => fd.get(key) === "on" || fd.get(key) === "true";

/** A File that actually has content (an empty file input submits one nameless, zero-byte File). */
const isRealFile = (v: FormDataEntryValue): v is File => typeof v !== "string" && (v.size > 0 || v.name !== "");

/** Pulls the raw form into the shape `quoteSchema` expects, plus the actual photo `File`s. */
export function parseQuoteFormData(fd: FormData): {
  raw: QuoteInput;
  values: QuoteFormValues;
  files: File[];
  /** Raw `photo_paths` values (unvalidated; `quoteSchema` checks them). */
  photoPaths: string[];
  honeypot: string;
} {
  const services = fd.getAll("services").filter((v): v is string => typeof v === "string");
  const preferredDays = fd
    .getAll("preferredDays")
    .map((v) => (typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const files = fd.getAll("photos").filter(isRealFile);
  const photoPaths = fd
    .getAll("photo_paths")
    .filter((v): v is string => typeof v === "string" && v !== "")
    .slice(0, 20);

  const utm: Record<string, string> = {};
  for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = text(fd, `utm_${k}`).trim();
    if (v) utm[k] = v.slice(0, 200);
  }

  const values: QuoteFormValues = {
    name: text(fd, "name"),
    email: text(fd, "email"),
    phone: text(fd, "phone"),
    street: text(fd, "street"),
    city: text(fd, "city"),
    state: text(fd, "state"),
    zip: text(fd, "zip"),
    services,
    customRequest: text(fd, "customRequest"),
    preferredDays,
    emailOptIn: checked(fd, "emailOptIn"),
    smsOptIn: checked(fd, "smsOptIn"),
    snowList: checked(fd, "snowList"),
  };

  return {
    raw: {
      ...values,
      photos: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      photoPaths,
      utm,
    },
    values,
    files,
    photoPaths,
    honeypot: text(fd, "company"),
  };
}
