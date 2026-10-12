import type { Customer, TreeCover } from "../db/types";
import { formatPhone, normalizePhone } from "./phone";
import { check, one } from "./types";
import type { Db } from "./types";

export type UpsertCustomerInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  parcel_id?: string | null;
  lot_acres?: number | null;
  tree_cover?: TreeCover | null;
  email_opt_in?: boolean;
  sms_opt_in?: boolean;
  snow_list?: boolean;
  notes?: string | null;
  /**
   * Default false: existing non-empty values are kept, and an existing `true` opt-in is never
   * downgraded. With `explicit: true` (customer changed their own preferences, unsubscribe
   * link, STOP reply) every provided field overwrites, including opt-ins to false.
   */
  explicit?: boolean;
};

const OPT_INS = ["email_opt_in", "sms_opt_in", "snow_list"] as const;
const FILL_FIELDS = ["address", "lat", "lng", "parcel_id", "lot_acres", "tree_cover", "notes"] as const;

function cleanEmail(v: string | null | undefined): string | null {
  const e = v?.trim().toLowerCase();
  return e ? e : null;
}

/** Canonical stored phone: 10 digits for US numbers, otherwise the trimmed original. */
function canonicalPhone(v: string | null | undefined): string | null {
  const d = normalizePhone(v);
  if (!d) return null;
  return d.length === 10 ? d : (v ?? "").trim();
}

/**
 * Finds the customer by lower-cased email, then by normalised phone, else creates one.
 * Emails are stored lower-cased and phones as 10 digits; lookups also accept legacy
 * "(440) 823-5545" / "1440..." / "+1440..." spellings.
 */
export async function upsertCustomer(db: Db, input: UpsertCustomerInput): Promise<Customer> {
  const email = cleanEmail(input.email);
  const phone = canonicalPhone(input.phone);
  const digits = normalizePhone(input.phone);

  let found: Customer | null = null;
  if (email) {
    found = check(
      await db.from("customers").select("*").eq("email", email).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      "upsertCustomer(email)",
    );
  }
  if (!found && digits.length === 10) {
    const variants = [digits, formatPhone(digits), `1${digits}`, `+1${digits}`];
    found = check(
      await db.from("customers").select("*").in("phone", variants).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      "upsertCustomer(phone)",
    );
  }

  if (!found) {
    const row: Partial<Customer> = {
      name: input.name.trim(),
      email,
      phone,
      address: input.address ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      parcel_id: input.parcel_id ?? null,
      lot_acres: input.lot_acres ?? null,
      tree_cover: input.tree_cover ?? null,
      email_opt_in: input.email_opt_in ?? false,
      sms_opt_in: input.sms_opt_in ?? false,
      snow_list: input.snow_list ?? false,
      notes: input.notes ?? null,
    };
    return one(await db.from("customers").insert(row).select("*").single(), "upsertCustomer(insert)");
  }

  const explicit = input.explicit === true;
  const patch: Partial<Customer> = {};
  const name = input.name.trim();
  if (name && (explicit || !found.name?.trim())) {
    if (name !== found.name) patch.name = name;
  }
  if (email && (explicit || !found.email) && email !== found.email) patch.email = email;
  if (phone && (explicit || !found.phone) && phone !== found.phone) patch.phone = phone;
  for (const f of FILL_FIELDS) {
    const v = input[f];
    if (v === undefined || v === null) continue;
    const cur = found[f];
    if ((explicit || cur === null || cur === "") && v !== cur) (patch as Record<string, unknown>)[f] = v;
  }
  for (const f of OPT_INS) {
    const v = input[f];
    if (v === undefined) continue;
    if (v === found[f]) continue;
    if (v === false && found[f] === true && !explicit) continue; // never silently downgrade
    patch[f] = v;
  }

  if (Object.keys(patch).length === 0) return found;
  return one(
    await db.from("customers").update(patch).eq("id", found.id).select("*").single(),
    "upsertCustomer(update)",
  );
}
