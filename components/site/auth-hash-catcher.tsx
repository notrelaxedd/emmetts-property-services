"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Safety net for Supabase auth links. When a magic-link / invite redirect target isn't on the
 * project's allowed-redirect list, Supabase sends the user to the Site URL (this marketing site)
 * with the session in the URL hash: `#access_token=…&refresh_token=…`. Store that session and send
 * the user on to the app instead of leaving them on the home page.
 */
export function AuthHashCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(async ({ error }) => {
        if (error) throw error;
        // Clean the tokens out of the address bar before navigating.
        window.history.replaceState(null, "", window.location.pathname);
        const { data } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", data.user?.id ?? "")
          .maybeSingle();
        const recovery = params.get("type") === "recovery" || params.get("type") === "invite";
        if (!profile) {
          window.location.assign("/login?error=no-access");
        } else if (recovery) {
          window.location.assign("/account/password");
        } else {
          window.location.assign(profile.role === "owner" ? "/admin" : "/crew");
        }
      })
      .catch(() => window.location.assign("/login?error=link"));
  }, []);
  return null;
}
