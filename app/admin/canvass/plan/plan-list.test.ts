import { describe, expect, it } from "vitest";
import { skippedLine } from "@/components/admin/canvass/plan-list";

describe("skippedLine", () => {
  it("names only the non-zero exclusions, in the spec's order", () => {
    expect(skippedLine({ dnk: 3, recent: 5, noOverlap: 12 })).toBe("Skipped: 3 do-not-knock, 5 knocked recently, 12 outside the window");
    expect(skippedLine({ dnk: 0, recent: 2, noOverlap: 0 })).toBe("Skipped: 2 knocked recently");
  });

  it("is null when nothing was skipped", () => {
    expect(skippedLine({ dnk: 0, recent: 0, noOverlap: 0 })).toBeNull();
  });
});
