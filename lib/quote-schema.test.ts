import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  fieldErrorsFrom,
  formatAddress,
  isPendingPhotoPath,
  parseQuoteFormData,
  photoError,
  photoTypeOf,
  quoteSchema,
  sniffImageBytes,
  splitPhotoPath,
  type QuoteInput,
} from "./quote-schema";
import { parseUsAddress } from "./stripe/tax";
import { clientIpFrom, createRateLimiter } from "./rate-limit";

const valid: QuoteInput = {
  name: "Pat Neighbor",
  email: "  Pat@Example.com ",
  phone: "(440) 823-5545",
  street: "123 Wooster Rd",
  city: "Rocky River",
  state: "OH",
  zip: "44116",
  services: ["lawn-mowing"],
};

const jpg = (n: number, size = 1000) => ({ name: `p${n}.jpg`, type: "image/jpeg", size });

describe("quoteSchema", () => {
  it("accepts a valid submission and normalises it", () => {
    const r = quoteSchema.safeParse({ ...valid, preferredDays: [5, 1, 5], snowList: true });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.phone).toBe("4408235545");
    expect(r.data.preferredDays).toEqual([1, 5]);
    expect(r.data.snowList).toBe(true);
    expect(r.data.emailOptIn).toBe(false);
    expect(r.data.customRequest).toBe("");
    expect(r.data.photos).toEqual([]);
  });

  it("accepts a custom note instead of a service", () => {
    const r = quoteSchema.safeParse({ ...valid, services: [], customRequest: "Take down a dead hedge" });
    expect(r.success).toBe(true);
  });

  it("rejects when there is neither a service nor a note", () => {
    const r = quoteSchema.safeParse({ ...valid, services: [], customRequest: "   " });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).services).toMatch(/at least one service/i);
  });

  it("requires name, email, phone and every address part, with field-level messages", () => {
    const r = quoteSchema.safeParse({
      name: "",
      email: "nope",
      phone: "",
      street: "12",
      city: "R",
      state: "Ohio",
      zip: "4411",
      services: ["lawn-mowing"],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const errs = fieldErrorsFrom(r.error);
    expect(Object.keys(errs).sort()).toEqual(["city", "email", "name", "phone", "state", "street", "zip"]);
  });

  it("gives each address field its own failure message", () => {
    const errs = (patch: Partial<QuoteInput>) => {
      const r = quoteSchema.safeParse({ ...valid, ...patch });
      return r.success ? {} : fieldErrorsFrom(r.error);
    };
    expect(errs({ street: "  " }).street).toMatch(/street address/i);
    expect(errs({ street: "x".repeat(121) }).street).toMatch(/under 120/);
    expect(errs({ city: "R" }).city).toMatch(/enter the city/i);
    expect(errs({ city: "x".repeat(61) }).city).toMatch(/under 60/);
    expect(errs({ state: "O" }).state).toMatch(/2-letter state/i);
    expect(errs({ state: "OHI" }).state).toMatch(/2-letter state/i);
    expect(errs({ state: "1H" }).state).toMatch(/2-letter state/i);
    expect(errs({ zip: "4411" }).zip).toMatch(/5-digit ZIP/i);
    expect(errs({ zip: "44116-12" }).zip).toMatch(/5-digit ZIP/i);
    expect(errs({ zip: "abcde" }).zip).toMatch(/5-digit ZIP/i);
    expect(errs({})).toEqual({});
  });

  it("uppercases and trims the state", () => {
    const r = quoteSchema.safeParse({ ...valid, state: " oh " });
    expect(r.success && r.data.state).toBe("OH");
  });

  it("accepts a 5-digit ZIP and ZIP+4, trimmed", () => {
    const a = quoteSchema.safeParse({ ...valid, zip: " 44116 " });
    expect(a.success && a.data.zip).toBe("44116");
    const b = quoteSchema.safeParse({ ...valid, zip: "44116-1234" });
    expect(b.success && b.data.zip).toBe("44116-1234");
  });

  it.each([
    ["4408235545", "4408235545"],
    ["(440) 823-5545", "4408235545"],
    ["440.823.5545", "4408235545"],
    ["1-440-823-5545", "4408235545"],
    ["+1 440 823 5545", "4408235545"],
  ])("normalises phone %s", (input, expected) => {
    const r = quoteSchema.safeParse({ ...valid, phone: input });
    expect(r.success && r.data.phone).toBe(expected);
  });

  it.each(["823-5545", "44082355455", "abcdefghij", "(440) 823-554"])("rejects bad phone %s", (phone) => {
    const r = quoteSchema.safeParse({ ...valid, phone });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).phone).toMatch(/10-digit/);
  });

  it("allows up to the photo limit and rejects more", () => {
    const ok = Array.from({ length: MAX_PHOTOS }, (_, i) => jpg(i));
    expect(quoteSchema.safeParse({ ...valid, photos: ok }).success).toBe(true);

    const tooMany = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => jpg(i));
    const r = quoteSchema.safeParse({ ...valid, photos: tooMany });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).photos).toMatch(/up to 4/);
  });

  it("rejects oversize and non-image photos", () => {
    expect(photoError([jpg(1, MAX_PHOTO_BYTES + 1)])).toMatch(/over 8 MB/);
    expect(photoError([{ name: "a.pdf", type: "application/pdf", size: 10 }])).toMatch(/isn't a photo/);
    expect(photoError([jpg(1, MAX_PHOTO_BYTES)])).toBeNull();
  });

  it("falls back to the extension when the browser sends no MIME type (HEIC)", () => {
    expect(photoTypeOf({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(photoTypeOf({ name: "x.exe", type: "" })).toBeNull();
    expect(photoTypeOf({ name: "x.jpg", type: "text/html" })).toBeNull();
  });

  it("rejects unknown weekday numbers", () => {
    expect(quoteSchema.safeParse({ ...valid, preferredDays: [7] }).success).toBe(false);
  });
});

const BATCH = "0f8fad5b-d9cb-469f-a165-70867728950e";
const pending = (n: number, ext = "jpg") => `pending/${BATCH}/${n}.${ext}`;

describe("pending photo paths", () => {
  it.each([pending(1), pending(4, "png"), pending(2, "webp"), pending(3, "heic"), pending(1, "heif"), `pending/${crypto.randomUUID()}/2.jpg`])(
    "accepts %s",
    (path) => expect(isPendingPhotoPath(path)).toBe(true),
  );

  it.each([
    pending(5),
    pending(0),
    pending(1, "gif"),
    pending(1, "jpeg"),
    pending(1, "JPG"),
    `leads/${BATCH}/1.jpg`,
    `pending/${BATCH}/../1.jpg`,
    `pending/${BATCH}/1.jpg/`,
    `pending/${BATCH}/1.jpg\n`,
    ` pending/${BATCH}/1.jpg`,
    `pending/${BATCH}/sub/1.jpg`,
    `pending/${BATCH.toUpperCase()}/1.jpg`,
    `pending/${BATCH.slice(1)}/1.jpg`,
    `pending/${"-".repeat(36)}/1.jpg`,
    "pending//1.jpg",
    "../pending/x/1.jpg",
    "",
  ])("rejects %j", (path) => expect(isPendingPhotoPath(path)).toBe(false));

  it("splits a path into folder and file name", () => {
    expect(splitPhotoPath(pending(2, "png"))).toEqual({ dir: `pending/${BATCH}`, name: "2.png" });
  });
});

describe("sniffImageBytes", () => {
  const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(16 - b.length).fill(0)]);
  const ascii = (s: string, at = 0) => {
    const out = new Uint8Array(16);
    out.set(Array.from(s, (c) => c.charCodeAt(0)), at);
    return out;
  };

  it("recognises JPEG, PNG, WebP and HEIC/HEIF by content", () => {
    expect(sniffImageBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageBytes(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    const webp = ascii("RIFF");
    webp.set(Array.from("WEBP", (c) => c.charCodeAt(0)), 8);
    expect(sniffImageBytes(webp)).toBe("image/webp");
    const heic = ascii("ftypheic", 4);
    expect(sniffImageBytes(heic)).toBe("image/heic");
    expect(sniffImageBytes(ascii("ftypmif1", 4))).toBe("image/heic");
    expect(sniffImageBytes(ascii("ftypavif", 4))).toBe("image/heif");
  });

  it("rejects everything else", () => {
    expect(sniffImageBytes(ascii("<html><script>"))).toBeNull();
    expect(sniffImageBytes(ascii("GIF89a"))).toBeNull();
    expect(sniffImageBytes(new Uint8Array(0))).toBeNull();
    expect(sniffImageBytes(new Uint8Array(16))).toBeNull();
  });
});

describe("photo_paths", () => {
  it("parseQuoteFormData collects photo_paths and ignores empty values", () => {
    const fd = new FormData();
    fd.append("photo_paths", pending(1));
    fd.append("photo_paths", "");
    fd.append("photo_paths", pending(2, "png"));
    fd.append("photo_paths", new File([new Uint8Array(3)], "x.jpg"));
    const p = parseQuoteFormData(fd);
    expect(p.photoPaths).toEqual([pending(1), pending(2, "png")]);
    expect(p.raw.photoPaths).toEqual(p.photoPaths);
    expect(p.files).toHaveLength(0);
  });

  it("does not treat the unnamed/ignored file input as photos", () => {
    const fd = new FormData();
    fd.append("photos_direct", new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" }));
    fd.append("photo_paths", pending(1));
    const p = parseQuoteFormData(fd);
    expect(p.files).toHaveLength(0);
    expect(p.raw.photos).toEqual([]);
  });

  it("accepts up to four valid, distinct paths", () => {
    const r = quoteSchema.safeParse({ ...valid, photoPaths: [pending(1), pending(2), pending(3, "png"), pending(4, "webp")] });
    expect(r.success).toBe(true);
    expect(quoteSchema.safeParse(valid).success && quoteSchema.parse(valid).photoPaths).toEqual([]);
  });

  it("rejects more than four, malformed, and duplicate paths on the photos field", () => {
    const errs = (photoPaths: string[], photos: QuoteInput["photos"] = []) => {
      const r = quoteSchema.safeParse({ ...valid, photoPaths, photos });
      return r.success ? {} : fieldErrorsFrom(r.error);
    };
    expect(errs([pending(1), pending(2), pending(3), pending(4), `pending/${BATCH}/1.png`]).photos).toMatch(/up to 4/);
    expect(errs([`leads/${BATCH}/1.jpg`]).photos).toMatch(/add your photos again/i);
    expect(errs(["pending/not-a-uuid/1.jpg"]).photos).toMatch(/add your photos again/i);
    expect(errs([pending(1), pending(1)]).photos).toMatch(/add your photos again/i);
  });

  it("counts uploaded paths and files together against the limit", () => {
    const r = quoteSchema.safeParse({
      ...valid,
      photoPaths: [pending(1), pending(2), pending(3)],
      photos: [jpg(1), jpg(2)],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsFrom(r.error).photos).toMatch(/up to 4/);
    const ok = quoteSchema.safeParse({ ...valid, photoPaths: [pending(1), pending(2)], photos: [jpg(1), jpg(2)] });
    expect(ok.success).toBe(true);
  });
});

describe("formatAddress", () => {
  it("builds the one-line stored address", () => {
    expect(formatAddress({ street: "123 Main St", city: "Rocky River", state: "OH", zip: "44116" })).toBe(
      "123 Main St, Rocky River, OH 44116",
    );
  });

  it("formats parsed schema output and round-trips through the Stripe Tax parser", () => {
    const r = quoteSchema.safeParse({ ...valid, street: " 123 Main St ", state: "oh", zip: "44116-1234" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const line = formatAddress(r.data);
    expect(line).toBe("123 Main St, Rocky River, OH 44116-1234");
    expect(parseUsAddress(line)).toEqual({
      line1: "123 Main St",
      city: "Rocky River",
      state: "OH",
      postal_code: "44116",
      country: "US",
    });
  });
});

describe("parseQuoteFormData", () => {
  it("reads checkboxes, days, utm and ignores the empty file input entry", () => {
    const fd = new FormData();
    fd.set("name", "Pat");
    fd.append("services", "lawn-mowing");
    fd.append("services", "snow-removal");
    fd.append("preferredDays", "1");
    fd.append("preferredDays", "x");
    fd.set("emailOptIn", "on");
    fd.set("utm_source", "nextdoor");
    fd.set("company", "bot inc");
    fd.append("photos", new File([], ""));
    const p = parseQuoteFormData(fd);
    expect(p.values.services).toEqual(["lawn-mowing", "snow-removal"]);
    expect(p.values.preferredDays).toEqual([1]);
    expect(p.values.emailOptIn).toBe(true);
    expect(p.values.smsOptIn).toBe(false);
    expect(p.raw.utm).toEqual({ source: "nextdoor" });
    expect(p.files).toHaveLength(0);
    expect(p.honeypot).toBe("bot inc");
  });

  it("reads the four address fields into values and raw", () => {
    const fd = new FormData();
    fd.set("street", "123 Main St");
    fd.set("city", "Rocky River");
    fd.set("state", "oh");
    fd.set("zip", "44116");
    const p = parseQuoteFormData(fd);
    expect(p.values).toMatchObject({ street: "123 Main St", city: "Rocky River", state: "oh", zip: "44116" });
    expect(p.raw).toMatchObject({ street: "123 Main St", city: "Rocky River", state: "oh", zip: "44116" });
  });

  it("collects real photo files", () => {
    const fd = new FormData();
    fd.append("photos", new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" }));
    const p = parseQuoteFormData(fd);
    expect(p.files).toHaveLength(1);
    expect(p.raw.photos).toEqual([{ name: "a.jpg", type: "image/jpeg", size: 10 }]);
  });
});

describe("rate limiter", () => {
  it("allows 5 per 10 minutes then blocks, and slides", () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 600_000 });
    for (let i = 0; i < 5; i++) expect(rl.hit("1.2.3.4", 1000 + i).ok).toBe(true);
    const blocked = rl.hit("1.2.3.4", 2000);
    expect(blocked.ok).toBe(false);
    expect(rl.hit("5.6.7.8", 2000).ok).toBe(true);
    expect(rl.hit("1.2.3.4", 1000 + 600_001).ok).toBe(true);
  });

  it("reads the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(clientIpFrom(h)).toBe("9.9.9.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
