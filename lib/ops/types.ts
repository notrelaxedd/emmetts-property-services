import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";

/** Service-role Supabase client typed with our hand-maintained `Database` contract. */
export type Db = SupabaseClient<Database>;

/** Throws a readable error for a Supabase `{ error }` result. */
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like `check`, but for `.single()` results: also throws if no row came back. */
export function one<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = check(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no row returned`);
  return data as NonNullable<T>;
}
