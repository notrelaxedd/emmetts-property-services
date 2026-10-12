/** Service-role Supabase client for the fleet. Never shipped to a browser. */
import { createClient } from "@supabase/supabase-js";
import type { Database, Row, TableName } from "../lib/db/types";
import { check } from "../lib/ops/types";
import type { Db } from "../lib/ops/types";

export function createFleetDb(url: string, serviceRoleKey: string): Db {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "eod-fleet" } },
  });
}

/** One row by id, or null. */
export async function getById<T extends TableName>(db: Db, table: T, id: string): Promise<Row<T> | null> {
  // The generic Database typing cannot narrow a union table name; the cast is safe by construction.
  const q = db.from(table as "jobs").select("*").eq("id", id).maybeSingle();
  return check(await q, `${table}(${id})`) as unknown as Row<T> | null;
}
