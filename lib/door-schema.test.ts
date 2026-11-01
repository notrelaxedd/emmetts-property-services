import { describe, expect, it } from "vitest";
import {
  addDays,
  doorFieldErrorsFrom,
  doorSchema,
  formatDoorDate,
  formatPhoneAsTyped,
  isRealIsoDate,
  localIsoDate,
  parseDoorFormData,
} from "./door-schema";

const TODAY = "2026-11-07";
const schema = doorSchema(TODAY);
const good = {
  name: "Pat Jones",
  phone: "(440) 555-1234",
  address: "123 Lake Rd",
  date: "2026-11-08",
  services: ["mowing", "leaves_front"],
};

describe("doorSchema", () => {
  it("accepts a complete booking and normalises phone + service order", () => {
    const r = schema.safeParse(good);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.phone).toBe("4405551234");
    expect(r.data.services).toEqual(["leaves_front", "mowing"]);
    expect(r.data.name).toBe("Pat Jones");
  });

  it("drops a duplicate service from a double tap", () => {
    const r = schema.safeParse({ ...good, services: ["edging", "edging"] });
    expect(r.success && r.data.services).toEqual(["edging"]);
  });

  it("names every missing field with its short message", () => {
    const r = schema.safeParse({ name: " ", phone: "", address: "", date: "", services: [] });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(doorFieldErrorsFrom(r.error)).toEqual({
      name: "Add their name",
      phone: "Add their phone number",
      address: "Add the street address",
      date: "Pick a day",
      services: "Pick at least one",
    });
  });

  it("wants all 10 digits, and strips a leading 1", () => {
    const short = schema.safeParse({ ...good, phone: "440 555" });
    expect(!short.success && doorFieldErrorsFrom(short.error).phone).toBe("Enter all 10 digits");
    const long = schema.safeParse({ ...good, phone: "1 (440) 555-1234" });
    expect(long.success && long.data.phone).toBe("4405551234");
    const tooLong = schema.safeParse({ ...good, phone: "44055512345" });
    expect(tooLong.success).toBe(false);
  });

  it("allows today, rejects yesterday, a fake date and a year that's a typo", () => {
    expect(schema.safeParse({ ...good, date: TODAY }).success).toBe(true);
    const past = schema.safeParse({ ...good, date: "2026-11-06" });
    expect(!past.success && doorFieldErrorsFrom(past.error).date).toBe("That day already passed");
    const fake = schema.safeParse({ ...good, date: "2026-02-30" });
    expect(!fake.success && doorFieldErrorsFrom(fake.error).date).toBe("Pick a day");
    const far = schema.safeParse({ ...good, date: "2036-11-08" });
    expect(!far.success && doorFieldErrorsFrom(far.error).date).toBe("That day is too far out");
  });

  it("rejects a service that isn't on the form", () => {
    const r = schema.safeParse({ ...good, services: ["gutters"] });
    expect(!r.success && doorFieldErrorsFrom(r.error).services).toBe("Pick at least one");
  });
});

describe("helpers", () => {
  it("formats a phone number as it's typed", () => {
    expect(formatPhoneAsTyped("")).toBe("");
    expect(formatPhoneAsTyped("4")).toBe("(4");
    expect(formatPhoneAsTyped("440")).toBe("(440) ");
    expect(formatPhoneAsTyped("4405")).toBe("(440) 5");
    expect(formatPhoneAsTyped("440555")).toBe("(440) 555");
    expect(formatPhoneAsTyped("4405551")).toBe("(440) 555-1");
    expect(formatPhoneAsTyped("4405551234")).toBe("(440) 555-1234");
    expect(formatPhoneAsTyped("44055512349999")).toBe("(440) 555-1234");
    expect(formatPhoneAsTyped("(440) 555-1234")).toBe("(440) 555-1234");
  });

  it("writes the date out and does day arithmetic by calendar day", () => {
    expect(formatDoorDate("2026-11-07")).toBe("Saturday, Nov 7");
    expect(formatDoorDate("2027-01-01")).toBe("Friday, Jan 1");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // across the US DST change
    expect(isRealIsoDate("2026-11-08")).toBe(true);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("11/08/2026")).toBe(false);
  });

  it("works out today in Ohio, not UTC", () => {
    // 03:30 UTC on Nov 8 is still 23:30 on Nov 7 in Ohio (EST).
    expect(localIsoDate(new Date("2026-11-08T03:30:00Z"))).toBe("2026-11-07");
    expect(localIsoDate(new Date("2026-11-08T05:30:00Z"))).toBe("2026-11-08");
  });

  it("reads only the five fields and the honeypot out of a FormData", () => {
    const fd = new FormData();
    fd.set("name", "Pat");
    fd.set("phone", "(440) 555-1234");
    fd.set("address", "1 Main St");
    fd.set("date", "2026-11-08");
    fd.append("services", "mowing");
    fd.append("services", "edging");
    fd.set("company", "");
    fd.set("price", "999");
    const { values, honeypot } = parseDoorFormData(fd);
    expect(values).toEqual({ name: "Pat", phone: "(440) 555-1234", address: "1 Main St", date: "2026-11-08", services: ["mowing", "edging"] });
    expect(honeypot).toBe("");
    expect("price" in values).toBe(false);
  });
});
