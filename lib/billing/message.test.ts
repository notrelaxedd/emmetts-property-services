import { describe, expect, it } from "vitest";
import { billMessage, mailtoHref, smsHref } from "./message";

describe("bill messages", () => {
  it("writes a short bill with the right plural and pay line", () => {
    const m = billMessage({ customerName: "Pat Smith", service: "snow removal", monthLabel: "December 2026", count: 3, unit: "push", amount: 105, payMethod: "check" });
    expect(m.body).toContain("Hi Pat, here's your snow removal bill for December 2026: 3 pushes, $105 total.");
    expect(m.body).toContain("check");
    const c = billMessage({ customerName: "Lee", service: "lawn mowing", monthLabel: "June 2026", count: 1, unit: "cut", amount: 40.5, payMethod: null });
    expect(c.body).toContain("1 cut, $40.50 total");
  });
  it("builds sms and mailto links", () => {
    expect(smsHref("(216) 555-0100", "hi there")).toBe("sms:+12165550100?&body=hi%20there");
    expect(mailtoHref("a@b.co", "S", "B")).toBe("mailto:a%40b.co?subject=S&body=B");
  });
});
