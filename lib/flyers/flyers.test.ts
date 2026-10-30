import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  CODE_ALPHABET,
  attributedCode,
  flyerLandingPath,
  flyerUrl,
  genericFlyerUrl,
  isBot,
  normalizeCode,
  randomCode,
} from "./codes";
import { jpegPagePdf } from "./pdf";
import { emptyFunnel, flyerFunnels, percent, totalFunnel } from "./stats";

vi.mock("server-only", () => ({}));

describe("flyer codes", () => {
  it("draws codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCode();
      expect(code).toMatch(/^[A-Z0-9]{4}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(randomCode(() => 0)).toBe("AAAA");
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("normalizes codes and rejects junk", () => {
    expect(normalizeCode(" k7m2 ")).toBe("K7M2");
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCDEFGHI")).toBeNull();
    expect(normalizeCode("K7-M2")).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });

  it("builds the QR link and the landing page", () => {
    expect(flyerUrl("https://eodlawns.com/", "K7M2")).toBe("https://eodlawns.com/f/K7M2");
    expect(flyerLandingPath("K7M2")).toBe("/quote?utm_source=flyer&utm_medium=qr&utm_campaign=K7M2");
    expect(genericFlyerUrl("https://eodlawns.com/")).toBe("https://eodlawns.com/quote?utm_source=flyer&utm_medium=qr");
    // No campaign, so a generic scan credits no one (an earlier worker scan's cookie still can).
    expect(attributedCode({ source: "flyer" }, undefined)).toBeNull();
  });

  it("credits the utm tags first, then the scan cookie", () => {
    expect(attributedCode({ source: "flyer", campaign: "k7m2" }, "ZZZZ")).toBe("K7M2");
    expect(attributedCode({ source: "facebook", campaign: "fall" }, "zzzz")).toBe("ZZZZ");
    expect(attributedCode({ source: "flyer", campaign: "??" }, "ZZZZ")).toBe("ZZZZ");
    expect(attributedCode({}, undefined)).toBeNull();
    expect(attributedCode({ source: "facebook", campaign: "K7M2" }, null)).toBeNull();
  });

  it("spots link-preview bots", () => {
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(false);
  });
});

describe("flyer funnels", () => {
  const input = {
    batches: [
      { flyer_worker_id: "a", flyer_count: 200, amount: 20, paid_at: "2026-10-01T00:00:00Z" },
      { flyer_worker_id: "a", flyer_count: 300, amount: 37.5, paid_at: null },
      { flyer_worker_id: "b", flyer_count: 100, amount: 10, paid_at: null },
    ],
    scans: [
      { flyer_worker_id: "a", visitor: "v1" },
      { flyer_worker_id: "a", visitor: "v1" },
      { flyer_worker_id: "a", visitor: "v2" },
      { flyer_worker_id: "c", visitor: "v9" },
    ],
    leads: [
      { id: "l1", flyer_worker_id: "a", status: "won" },
      { id: "l2", flyer_worker_id: "a", status: "quoted" },
      { id: "l3", flyer_worker_id: "a", status: "spam" },
      { id: "l4", flyer_worker_id: "b", status: "new" },
      { id: "l5", flyer_worker_id: null, status: "won" },
    ],
    bookedLeadIds: new Set(["l1", "l3", "l5"]),
  };

  it("counts flyers, unique scans, requests, bookings and pay per worker", () => {
    const f = flyerFunnels(input);
    expect(f.get("a")).toEqual({
      flyersOut: 500,
      scans: 2,
      requests: 2,
      booked: 1,
      conversion: 1 / 500,
      scanRate: 2 / 500,
      closeRate: 1 / 2,
      owed: 37.5,
      paid: 20,
    });
    expect(f.get("b")).toMatchObject({ flyersOut: 100, scans: 0, requests: 1, booked: 0, conversion: 0, owed: 10, paid: 0 });
    // Scans before any batch is logged: no conversion rate yet.
    expect(f.get("c")).toMatchObject({ flyersOut: 0, scans: 1, conversion: null, scanRate: null, closeRate: null });
  });

  it("totals across workers", () => {
    const t = totalFunnel(flyerFunnels(input).values());
    expect(t).toMatchObject({ flyersOut: 600, scans: 3, requests: 3, booked: 1, owed: 47.5, paid: 20 });
    expect(t.conversion).toBeCloseTo(1 / 600);
    expect(emptyFunnel()).toMatchObject({ flyersOut: 0, conversion: null, owed: 0 });
  });

  it("formats rates", () => {
    expect(percent(null)).toBe("—");
    expect(percent(0)).toBe("0%");
    expect(percent(1 / 500)).toBe("0.2%");
    expect(percent(0.5)).toBe("50%");
  });
});

describe("flyer pdf", () => {
  it("writes a one-page US Letter PDF whose xref offsets point at its objects", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = jpegPagePdf(jpeg, { width: 10, height: 13 });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 612 792]");
    expect(text).toContain("/Width 10 /Height 13");
    expect(text).toContain(`/Length ${jpeg.length}`);
    const xrefAt = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = Array.from(text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)).map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});

describe("flyer render", () => {
  type Box = { left: number; top: number; width: number; height: number };

  /** Share of a region's pixels (greyscale) in each band: placeholder gray, QR black, the code's light gray. */
  async function tones(image: Buffer | string, box: Box) {
    const { data } = await sharp(image).extract(box).greyscale().raw().toBuffer({ resolveWithObject: true });
    let gray = 0;
    let dark = 0;
    let label = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 100 && data[i] < 130) gray++;
      if (data[i] < 40) dark++;
      if (data[i] >= 140 && data[i] <= 170) label++;
    }
    return { gray: gray / data.length, dark: dark / data.length, label };
  }

  it("has a flat gray placeholder exactly where FLYER_TEMPLATE says", async () => {
    const { FLYER_TEMPLATE } = await import("./render");
    const meta = await sharp(FLYER_TEMPLATE.file).metadata();
    expect([meta.width, meta.height]).toEqual([FLYER_TEMPLATE.width, FLYER_TEMPLATE.height]);
    // Stale coordinates (after re-rendering the template) would miss part of the gray box.
    expect((await tones(FLYER_TEMPLATE.file, FLYER_TEMPLATE.qrBox)).gray).toBeGreaterThan(0.98);
  });

  it("puts the QR code and the worker's code over the gray placeholder box", async () => {
    const { FLYER_TEMPLATE, PRINT_SCALE, renderFlyerPng, renderFlyerPdf } = await import("./render");
    const png = await renderFlyerPng("https://eodlawns.com/f/K7M2", "K7M2");
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([FLYER_TEMPLATE.width * PRINT_SCALE, FLYER_TEMPLATE.height * PRINT_SCALE]);

    // The placeholder was flat gray (115); now the box is white paper with black QR modules and the
    // code in light gray (the QR itself is pure black and white).
    const { qrBox } = FLYER_TEMPLATE;
    const box = {
      left: qrBox.left * PRINT_SCALE,
      top: qrBox.top * PRINT_SCALE,
      width: qrBox.width * PRINT_SCALE,
      height: qrBox.height * PRINT_SCALE,
    };
    const inside = await tones(png, box);
    expect(inside.gray).toBeLessThan(0.02);
    expect(inside.dark).toBeGreaterThan(0.15);
    expect(inside.label).toBeGreaterThan(200);

    // No gray edge left around it either.
    const m = 8 * PRINT_SCALE;
    const around = await tones(png, { left: box.left - m, top: box.top - m, width: box.width + 2 * m, height: box.height + 2 * m });
    expect(around.gray).toBeLessThan(0.005);

    const pdf = await renderFlyerPdf("https://eodlawns.com/f/K7M2", "K7M2");
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  }, 30_000);
});
