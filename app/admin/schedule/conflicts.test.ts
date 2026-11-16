import { describe, expect, it } from "vitest";
import { at, block, crewException } from "@/lib/scheduler/fixtures";
import { checkMove, type MoveCheckInput } from "./conflicts";

// 2026-10-13 is a Tuesday.
const DAY = "2026-10-13";
const kevin = { id: "c1", name: "Kevin Smith" };

function input(over: Partial<MoveCheckInput> = {}): MoveCheckInput {
  return {
    jobId: "j1",
    start: new Date(at(DAY, "09:00")),
    end: new Date(at(DAY, "10:30")),
    crew: [kevin],
    crewAvailability: [block("c1", 2, "08:00", "12:00")],
    crewExceptions: [],
    otherAssignments: [],
    ...over,
  };
}

describe("checkMove", () => {
  it("allows a slot where the crew is free", () => {
    expect(checkMove(input())).toBeNull();
  });

  it("allows any time of day when no crew is picked (no owner open hours)", () => {
    const late = { start: new Date(at(DAY, "19:00")), end: new Date(at(DAY, "21:00")), crew: [] };
    expect(checkMove(input(late))).toBeNull();
    const sunday = { start: new Date(at("2026-10-18", "06:00")), end: new Date(at("2026-10-18", "07:00")), crew: [] };
    expect(checkMove(input(sunday))).toBeNull();
  });

  it("rejects when the crew member is not available that weekday", () => {
    expect(checkMove(input({ crewAvailability: [block("c1", 3, "08:00", "12:00")] }))).toMatch(/Kevin isn't available/);
  });

  it("rejects approved time off but ignores pending requests", () => {
    const off = crewException("c1", DAY, { kind: "off", status: "approved" });
    expect(checkMove(input({ crewExceptions: [off] }))).toMatch(/time off/);
    expect(checkMove(input({ crewExceptions: [{ ...off, status: "pending" }] }))).toBeNull();
  });

  it("rejects overlapping assignments on other jobs, but not on the same job or dropped ones", () => {
    const other = { crew_id: "c1", job_id: "j2", status: "accepted" as const, start_at: at(DAY, "10:00"), end_at: at(DAY, "11:00") };
    expect(checkMove(input({ otherAssignments: [other] }))).toMatch(/another job/);
    expect(checkMove(input({ otherAssignments: [{ ...other, job_id: "j1" }] }))).toBeNull();
    expect(checkMove(input({ otherAssignments: [{ ...other, status: "dropped" }] }))).toBeNull();
    expect(checkMove(input({ otherAssignments: [{ ...other, start_at: at(DAY, "10:30") }] }))).toBeNull();
  });
});
