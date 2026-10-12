import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  fieldErrorsFrom,
  parseQuoteFormData,
  photoError,
  photoTypeOf,
  quoteSchema,
  type QuoteInput,
} from "./quote-schema";
import { clientIpFrom, createRateLimiter } from "./rate-limit";

const valid: QuoteInput = {
  name: "Pat Neighbor",
  email: "  Pat@Example.com ",
  phone: "(440) 823-5545",
  address: "123 Wooster Rd, Rocky River, OH",
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

  it("requires name, email, phone and address, with field-level messages", () => {
    const r = quoteSchema.safeParse({ name: "", email: "nope", phone: "", address: "12", services: ["lawn-mowing"] });
    expect(r.success).toBe(false);
    if (r.success) return;
    const errs = fieldErrorsFrom(r.error);
    expect(Object.keys(errs).sort()).toEqual(["address", "email", "name", "phone"]);
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
