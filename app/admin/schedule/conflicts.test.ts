import { describe, expect, it } from "vitest";
import { at, block, crewException, ownerException, OWNER_MON_FRI } from "@/lib/scheduler/fixtures";
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
    ownerWindows: OWNER_MON_FRI,
    ownerExceptions: [],
    crewAvailability: [block("c1", 2, "08:00", "12:00")],
    crewExceptions: [],
    otherAssignments: [],
    ...over,
  };
}

describe("checkMove", () => {
  it("allows a slot inside owner hours where the crew is free", () => {
    expect(checkMove(input())).toBeNull();
  });

  it("rejects slots outside owner windows and on closed days", () => {
    expect(checkMove(input({ start: new Date(at(DAY, "16:30")), end: new Date(at(DAY, "18:00")) }))).toMatch(
      /outside your open hours/,
    );
    expect(checkMove(input({ ownerExceptions: [ownerException(DAY, { closed: true })] }))).toMatch(/outside/);
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
