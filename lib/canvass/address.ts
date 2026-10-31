/**
 * Addresses and owner names for the people-facing surfaces (titles, popups, route stops, door greetings).
 * Pure: no next/* or db imports.
 *
 * The county gives us SHOUTING site addresses ("W 210TH ST") and owners in "LAST FIRST" order
 * ("SMITH JOHN & JANE"). This module turns those into "W 210th St, Rocky River, OH 44116" and "John".
 */
import type { Parcel } from "../db/types";

export { houseNumber } from "./score";

/** What `fullAddress` needs. `state` is optional so rows that predate the column still work. */
export type AddressParts = Pick<Parcel, "address" | "city" | "zip"> & { state?: string | null };

/** Tokens that stay upper case in a street line: compass directions, PO, route prefixes. */
const STREET_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO", "US", "SR", "CR", "OH", "I"]);

/** "O'BRIEN" → "O'Brien": a one-letter prefix before an apostrophe capitalises the next letter too. */
function capitalizeWord(word: string): string {
  const lower = word.toLowerCase();
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  const m = /^([a-z]')([a-z].*)$/i.exec(cap);
  return m ? m[1].toUpperCase() + m[2].charAt(0).toUpperCase() + m[2].slice(1) : cap;
}

function titleCaseToken(token: string, keepUpper: boolean): string {
  if (!token) return token;
  // 210TH → 210th, 1ST → 1st; 12A / 4B → 12A / 4B (unit letters stay upper).
  const ordinal = /^(\d+)(st|nd|rd|th)$/i.exec(token);
  if (ordinal) return ordinal[1] + ordinal[2].toLowerCase();
  if (/^\d+[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^\d/.test(token) || /^#/.test(token)) return token.toUpperCase();
  if (keepUpper && STREET_UPPER.has(token.toUpperCase().replace(/\./g, ""))) return token.toUpperCase();
  return token
    .split("-")
    .map((part) => capitalizeWord(part))
    .join("-");
}

function titleCase(text: string, keepUpper: boolean): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => titleCaseToken(t, keepUpper))
    .join(" ");
}

/**
 * "1234 LAKEVIEW AVE" → "1234 Lakeview Ave"; "W 210TH ST" → "W 210th St"; "55 NE 3RD AVE" → "55 NE 3rd Ave".
 * Compass directions (N, S, E, W, NE …) stay upper case; unit numbers like "APT 4B" keep the letter upper.
 * Already mixed-case input comes back unchanged in shape, so it is safe to apply twice.
 */
export function titleCaseAddress(address: string | null | undefined): string {
  return titleCase(address ?? "", true);
}

/** "ROCKY RIVER" → "Rocky River". */
export function titleCaseCity(city: string | null | undefined): string {
  return titleCase(city ?? "", false);
}

/** First five digits of a ZIP / ZIP+4; "" when there are not five. */
export function zip5(zip: string | number | null | undefined): string {
  const m = /\d{5}/.exec(String(zip ?? ""));
  return m ? m[0] : "";
}

/**
 * "1234 Lakeview Ave, Rocky River, OH 44116". Missing parts are skipped without dangling commas:
 * no city → "1234 Lakeview Ave, OH 44116"; no state or zip → "1234 Lakeview Ave, Rocky River".
 */
export function fullAddress(p: AddressParts): string {
  const street = titleCaseAddress(p.address);
  const city = titleCaseCity(p.city);
  const state = (p.state ?? "").trim().toUpperCase();
  const zip = zip5(p.zip);
  const region = [state, zip].filter(Boolean).join(" ");
  return [street, city, region].filter(Boolean).join(", ");
}

// ---------- Owner first name ----------

/**
 * Company / trust owners. Same list as county.ts ENTITY_OWNER_RE, kept local so this module stays free of the
 * county client (it is imported by client components). Keep the two in step.
 */
const ENTITY_OWNER_RE =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|TRUST|TRUSTEE|TRUSTEES|TR|LTD|LP|LLP|PROPERTIES|HOLDINGS|REALTY|INVESTMENTS|BANK|CHURCH|CITY OF|HOUSING|ASSOCIATION|ASSN|PARTNERS|PARTNERSHIP|ENTERPRISES|RENTALS)\b/i;
/** Words that mean "this is not a person" beyond the entity pattern. */
const NOT_A_PERSON = /\b(FAMILY|ESTATE|LIVING|REVOCABLE|IRREVOCABLE|TRS|HEIRS|UNKNOWN|VACANT|ETC|OF|THE)\b/i;
/** Surname particles: "VAN DER BERG JOHN" is surname "VAN DER BERG". */
const SURNAME_PARTICLES = new Set(["VAN", "VON", "DE", "DEL", "DER", "DI", "DA", "LA", "LE", "ST"]);
/** Tokens that are never a first name. */
const SKIP_TOKENS = new Set(["JR", "SR", "II", "III", "IV", "MR", "MRS", "MS", "DR", "ET", "AL", "ETAL", "ETUX", "ETVIR", "AND"]);

const isNameToken = (t: string) => /^[A-Za-z][A-Za-z'’-]+$/.test(t) && !SKIP_TOKENS.has(t.toUpperCase());

/** Token list of one owner segment, with commas and periods removed. */
const tokensOf = (s: string) =>
  s
    .replace(/[.]/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);

/**
 * A first name for the doorstep greeting from the county's owner string, or null when none can be found
 * (companies, trusts, lone surnames). County owners are "LAST FIRST [MI] [& SPOUSE]" or "LAST, FIRST":
 *   "SMITH JOHN & JANE" → "John"      "SMITH, JOHN" → "John"      "SMITH JOHN A" → "John"
 *   "JOHN & JANE SMITH" → "John"      "ACME HOLDINGS LLC" → null  "SMITH" → null
 * Only the first named person is used. Never looks anything up: the string is all we have.
 */
export function ownerFirstName(ownerDisplay: string | null | undefined): string | null {
  const raw = (ownerDisplay ?? "").trim();
  if (!raw) return null;
  if (ENTITY_OWNER_RE.test(raw) || NOT_A_PERSON.test(raw)) return null;

  const segments = raw
    .split(/\s*(?:&|\band\b|\/)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  const first = segments[0];
  const hasComma = first.includes(",");
  const tokens = tokensOf(first);

  let given: string[];
  if (hasComma) {
    // "SMITH, JOHN" / "SMITH JR, JOHN A": everything after the first comma is given names.
    given = tokensOf(first.slice(first.indexOf(",") + 1));
  } else if (tokens.length === 1) {
    // "JOHN & JANE SMITH": a lone first segment is a first name only when the pair shares a surname
    // written after the second person; "SMITH & JONES" style input cannot be told apart, so need a 2+ token tail.
    const tail = segments.slice(1).some((s) => tokensOf(s).length >= 2);
    given = segments.length > 1 && tail ? tokens : [];
  } else {
    let i = 1;
    while (i < tokens.length - 1 && SURNAME_PARTICLES.has(tokens[i - 1].toUpperCase())) i++;
    given = tokens.slice(i);
  }

  const name = given.find(isNameToken);
  return name ? titleCase(name, false) : null;
}
