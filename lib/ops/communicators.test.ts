import { describe, expect, it } from "vitest";
import { parseWho, pickable, sortTeam, whoParam, type TeamMember } from "./communicators";

const ME = "11111111-1111-4111-8111-111111111111";
const JAKE = "22222222-2222-4222-8222-222222222222";

const team: TeamMember[] = [
  { id: "c1", name: "zed", role: "crew", removed: false },
  { id: JAKE, name: "Jake", role: "owner", removed: false },
  { id: "c2", name: "Amy", role: "crew", removed: true },
  { id: ME, name: "Emmett", role: "owner", removed: false },
];

describe("sortTeam", () => {
  it("puts owners first, then sorts by name ignoring case", () => {
    expect(sortTeam(team).map((m) => m.name)).toEqual(["Emmett", "Jake", "Amy", "zed"]);
  });
});

describe("pickable", () => {
  it("hides removed members unless they're the one already assigned", () => {
    expect(pickable(team).map((m) => m.id)).toEqual(["c1", JAKE, ME]);
    expect(pickable(team, "c2").map((m) => m.id)).toEqual(["c1", JAKE, "c2", ME]);
  });
});

describe("parseWho / whoParam", () => {
  it("reads me, none and a profile id", () => {
    expect(parseWho("me", ME)).toEqual({ kind: "person", id: ME, me: true });
    expect(parseWho("none", ME)).toEqual({ kind: "none" });
    expect(parseWho(JAKE, ME)).toEqual({ kind: "person", id: JAKE, me: false });
    expect(parseWho(ME.toUpperCase(), ME)).toEqual({ kind: "person", id: ME, me: true });
  });

  it("falls back to everyone for anything else", () => {
    for (const raw of [undefined, "", "bob", "'; drop table", ["me"]]) expect(parseWho(raw, ME)).toEqual({ kind: "all" });
    expect(parseWho("me", null)).toEqual({ kind: "all" });
  });

  it("round-trips through the URL value", () => {
    expect(whoParam(parseWho(undefined, ME))).toBeNull();
    expect(whoParam(parseWho("none", ME))).toBe("none");
    expect(whoParam(parseWho("me", ME))).toBe("me");
    expect(whoParam(parseWho(ME, ME))).toBe("me");
    expect(whoParam(parseWho(JAKE, ME))).toBe(JAKE);
  });
});
