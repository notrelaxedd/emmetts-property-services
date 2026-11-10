import { describe, expect, it } from "vitest";
import { doorAddress, doorDayLabel, doorFieldErrors, doorNote, doorPreferredDays, doorSchema, doorWants, parseDoorFormData } from "./door-schema";

const TODAY = "2026-11-09"; // a Monday
const valid = {
  name: "  Pat Neighbor ",
  phone: "(440) 823-5545",
  street: "123 Wooster Rd",
  city: "Rocky River",
  date: "2026-11-14",
  services: ["fall-cleanup", "edging", "fall-cleanup"],
};

describe("doorSchema", () => {
  it("accepts a booking and cleans it up", () => {
    const r = doorSchema(TODAY).parse(valid);
    expect(r).toEqual({
      name: "Pat Neighbor",
      phone: "4408235545",
      street: "123 Wooster Rd",
      city: "Rocky River",
      date: "2026-11-14",
      services: ["fall-cleanup", "edging"],
      other: "",
    });
  });

  it("takes Other on its own, or alongside services", () => {
    const only = doorSchema(TODAY).parse({ ...valid, services: [], other: "  Junk removal out back " });
    expect(only.services).toEqual([]);
    expect(only.other).toBe("Junk removal out back");
    expect(doorSchema(TODAY).parse({ ...valid, other: "Gutters on the garage" }).services).toEqual(["fall-cleanup", "edging"]);
    const none = doorSchema(TODAY).safeParse({ ...valid, services: [], other: "   " });
    expect(none.success).toBe(false);
    if (!none.success) expect(doorFieldErrors(none.error).services).toMatch(/Other/);
  });

  it("allows today but not a past day or one too far out", () => {
    expect(doorSchema(TODAY).safeParse({ ...valid, date: TODAY }).success).toBe(true);
    const past = doorSchema(TODAY).safeParse({ ...valid, date: "2026-11-08" });
    expect(past.success).toBe(false);
    if (!past.success) expect(doorFieldErrors(past.error).date).toMatch(/passed/);
    expect(doorSchema(TODAY).safeParse({ ...valid, date: "2027-06-01" }).success).toBe(false);
    expect(doorSchema(TODAY).safeParse({ ...valid, date: "" }).success).toBe(false);
  });

  it("needs a 10-digit phone and at least one service", () => {
    const r = doorSchema(TODAY).safeParse({ ...valid, phone: "823-5545", services: [] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = doorFieldErrors(r.error);
      expect(e.phone).toBeTruthy();
      expect(e.services).toBeTruthy();
    }
  });
});

describe("door helpers", () => {
  it("adds the ZIP for towns we serve", () => {
    expect(doorAddress({ street: "123 Wooster Rd", city: "Rocky River" })).toBe("123 Wooster Rd, Rocky River, OH 44116");
    expect(doorAddress({ street: "1 Main St", city: "westlake" })).toBe("1 Main St, westlake, OH 44145");
    expect(doorAddress({ street: "1 Main St", city: "Fairview Park" })).toBe("1 Main St, Fairview Park, OH");
  });

  it("labels the day and keeps its weekday", () => {
    expect(doorDayLabel("2026-11-14")).toBe("Sat, Nov 14");
    expect(doorPreferredDays("2026-11-14")).toEqual([6]);
    expect(doorNote({ date: "2026-11-14", street: "123 Wooster Rd", city: "Rocky River", other: "" }, ["Fall Cleanup", "Edging"])).toBe(
      "Door booking: wants Sat, Nov 14 (2026-11-14) for Fall Cleanup, Edging at 123 Wooster Rd, Rocky River, OH 44116.",
    );
    expect(doorWants(["Edging"], "Junk removal")).toBe("Edging, Other: Junk removal");
    expect(doorWants([], "Junk removal")).toBe("Other: Junk removal");
  });

  it("reads the form, including every ticked service and the honeypot", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: "Pat", phone: "4408235545", street: "1 A St", city: "Lakewood", date: "2026-11-14", company: "", other: "Junk removal" })) fd.set(k, v);
    fd.append("services", "fall-cleanup");
    fd.append("services", "edging");
    const { values, honeypot } = parseDoorFormData(fd);
    expect(values.services).toEqual(["fall-cleanup", "edging"]);
    expect(values.city).toBe("Lakewood");
    expect(values.other).toBe("Junk removal");
    expect(honeypot).toBe("");
  });
});
