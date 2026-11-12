import type { Role } from "../db/types";
import { check } from "./types";
import type { Db } from "./types";

/** Someone on the team who can be a customer's communicator (an owner or crew profile). */
export type TeamMember = { id: string; name: string; role: Role; removed: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every profile, owners first then by name. Removed members are kept so old assignments still show a name. */
export async function loadTeam(db: Db): Promise<TeamMember[]> {
  const rows = check(await db.from("profiles").select("id,name,role,removed_at"), "load team") ?? [];
  return sortTeam(
    rows.map((p) => ({ id: p.id, name: p.name.trim() || "Unnamed", role: p.role, removed: p.removed_at !== null })),
  );
}

export function sortTeam(team: TeamMember[]): TeamMember[] {
  return [...team].sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.role === "owner" ? -1 : 1,
  );
}

/** The people offered in a communicator dropdown: active members, plus `keepId` if it's a removed one. */
export function pickable(team: TeamMember[], keepId: string | null = null): TeamMember[] {
  return team.filter((m) => !m.removed || m.id === keepId);
}

/**
 * The Customers list's "Talking to" filter (`?who=`): `me`, `none`, or a profile id. Anything else
 * (missing, garbage) means everyone.
 */
export type WhoFilter = { kind: "all" } | { kind: "none" } | { kind: "person"; id: string; me: boolean };

export function parseWho(raw: unknown, myProfileId: string | null): WhoFilter {
  if (typeof raw !== "string") return { kind: "all" };
  if (raw === "none") return { kind: "none" };
  if (raw === "me") return myProfileId ? { kind: "person", id: myProfileId, me: true } : { kind: "all" };
  if (UUID_RE.test(raw)) return { kind: "person", id: raw.toLowerCase(), me: raw.toLowerCase() === myProfileId };
  return { kind: "all" };
}

/** The `who` value that selects this filter again (null for everyone). */
export function whoParam(f: WhoFilter): string | null {
  return f.kind === "all" ? null : f.kind === "none" ? "none" : f.me ? "me" : f.id;
}
