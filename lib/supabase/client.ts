"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

/** Browser client (anon key). Only ever sees what RLS allows for the signed-in user. */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
