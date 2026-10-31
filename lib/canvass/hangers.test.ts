import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, FLYER_COOKIE_MAX_AGE } from "../flyers/codes";
import {
  HANGER_COOKIE,
  HANGER_COOKIE_MAX_AGE,
  attributedHangerCode,
  hangerConversions,
  hangerLandingPath,
  hangerUrl,
  normalizeHangerCode,
  randomHangerCode,
  totalHangerConversions,
} from "./hangers";

describe("hanger codes", () => {
  it("uses the flyer alphabet (no 0/O/1/I/L) and a 60-day cookie", () => {
    for (let i = 0; i < 200; i++) {
      const code = randomHangerCode();
      expect(code).toMatch(/^[A-Z0-9]{4}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(randomHangerCode(() => 0)).toBe("AAAA");
    expect(HANGER_COOKIE).toBe("hanger");
    expect(HANGER_COOKIE_MAX_AGE).toBe(60 * 24 * 60 * 60);
    expect(HANGER_COOKIE_MAX_AGE).toBe(FLYER_COOKIE_MAX_AGE);
  });

  it("normalizes codes to the hanger_codes.code check and rejects junk", () => {
    expect(normalizeHangerCode(" k7m2 ")).toBe("K7M2");
    expect(normalizeHangerCode("abcdefgh")).toBe("ABCDEFGH");
    expect(normalizeHangerCode("ABC")).toBeNull();
    expect(normalizeHangerCode("ABCDEFGHI")).toBeNull();
    expect(normalizeHangerCode("K7-M2")).toBeNull();
    expect(normalizeHangerCode(null)).toBeNull();
    expect(normalizeHangerCode(undefined)).toBeNull();
  });

  it("builds the QR link and the landing path", () => {
    expect(hangerUrl("https://example.com/", "K7M2")).toBe("https://example.com/h/K7M2");
    expect(hangerUrl("https://example.com", "K7M2")).toBe("https://example.com/h/K7M2");
    expect(hangerLandingPath("K7M2")).toBe("/quote?src=hanger&s=K7M2&utm_source=hanger&utm_medium=qr&utm_campaign=K7M2");
    const u = new URL(hangerLandingPath("K7M2"), "https://example.com");
    expect(u.pathname).toBe("/quote");
    expect(u.searchParams.get("src")).toBe("hanger");
    expect(u.searchParams.get("s")).toBe("K7M2");
    expect(u.searchParams.get("utm_source")).toBe("hanger");
    expect(u.searchParams.get("utm_medium")).toBe("qr");
    expect(u.searchParams.get("utm_campaign")).toBe("K7M2");
  });

  it("credits src/s first, then utm_source/utm_campaign, then the cookie", () => {
    expect(attributedHangerCode({ src: "hanger", s: "k7m2" }, "ZZZZ")).toBe("K7M2");
    expect(attributedHangerCode({ source: "hanger", campaign: "k7m2" }, "ZZZZ")).toBe("K7M2");
    expect(attributedHangerCode({ src: "hanger", s: "AAAA", source: "hanger", campaign: "BBBB" }, "ZZZZ")).toBe("AAAA");
    expect(attributedHangerCode({ src: "hanger", s: "??", source: "hanger", campaign: "BBBB" }, "ZZZZ")).toBe("BBBB");
    expect(attributedHangerCode({ source: "hanger", campaign: "??" }, "zzzz")).toBe("ZZZZ");
    expect(attributedHangerCode({ source: "flyer", campaign: "K7M2" }, "ZZZZ")).toBe("ZZZZ");
    expect(attributedHangerCode({ src: "flyer", s: "K7M2" }, null)).toBeNull();
    expect(attributedHangerCode({}, undefined)).toBeNull();
    expect(attributedHangerCode({}, "bad code")).toBeNull();
  });
});

describe("hanger conversions", () => {
  const codes = [
    { code: "K7M2", street: "WAGAR RD" },
    { code: "P3QX", street: "BEACH CLIFF BLVD" },
    { code: "Z9Z9", street: "WOOSTER RD" },
  ];
  const events = [
    { code: "K7M2", event: "scan" as const, visitor: "v1" },
    { code: "K7M2", event: "scan" as const, visitor: "v1" }, // same phone twice
    { code: "K7M2", event: "scan" as const, visitor: "v2" },
    { code: "k7m2", event: "scan" as const, visitor: null }, // no hash: counts once, code case-insensitive
    { code: "K7M2", event: "booking" as const, visitor: null },
    { code: "P3QX", event: "booking" as const, visitor: null }, // booked without a logged scan
    { code: "NOPE", event: "scan" as const, visitor: "v9" }, // unknown code: ignored
  ];

  it("counts unique scans, bookings and the rate per street", () => {
    const rows = hangerConversions(codes, events);
    expect(rows.map((r) => r.street)).toEqual(["BEACH CLIFF BLVD", "WAGAR RD", "WOOSTER RD"]);
    expect(rows.find((r) => r.code === "K7M2")).toEqual({ code: "K7M2", street: "WAGAR RD", scans: 3, bookings: 1, rate: 1 / 3 });
    expect(rows.find((r) => r.code === "P3QX")).toEqual({ code: "P3QX", street: "BEACH CLIFF BLVD", scans: 0, bookings: 1, rate: null });
    expect(rows.find((r) => r.code === "Z9Z9")).toEqual({ code: "Z9Z9", street: "WOOSTER RD", scans: 0, bookings: 0, rate: null });
    expect(rows.some((r) => r.code === "NOPE")).toBe(false);
  });

  it("totals across streets", () => {
    expect(totalHangerConversions(hangerConversions(codes, events))).toEqual({ scans: 3, bookings: 2, rate: 2 / 3 });
    expect(totalHangerConversions([])).toEqual({ scans: 0, bookings: 0, rate: null });
    expect(hangerConversions([], events)).toEqual([]);
  });
});
