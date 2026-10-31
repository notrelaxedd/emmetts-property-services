import { describe, expect, it } from "vitest";
import { skippedLine } from "@/components/admin/canvass/plan-list";

describe("skippedLine", () => {
  it("names only the non-zero exclusions, in order", () => {
    expect(skippedLine({ dnk: 3, recent: 5 })).toBe("Skipped: 3 do-not-knock, 5 knocked recently");
    expect(skippedLine({ dnk: 0, recent: 2 })).toBe("Skipped: 2 knocked recently");
  });

  it("is null when nothing was skipped", () => {
    expect(skippedLine({ dnk: 0, recent: 0 })).toBeNull();
  });
});
