import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { services as siteServices, type ServiceIcon } from "@/lib/services";

export type QuoteServiceOption = { slug: string; name: string; blurb?: string; icon?: ServiceIcon };

const fallback = (): QuoteServiceOption[] =>
  siteServices.map((s) => ({ slug: s.slug, name: s.title, blurb: s.blurb, icon: s.icon }));

/**
 * Active services for the quote form's checkboxes. Reads `services` (active, in sort order) and
 * falls back to the site's static list when Supabase isn't configured or has nothing yet, so the
 * page always renders. Blurbs and icons come from `lib/services.ts` when the slug matches.
 */
export async function loadQuoteServices(): Promise<QuoteServiceOption[]> {
  const db = getSupabaseAdmin();
  if (!db) {
    console.warn("[quote] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; using the static service list");
    return fallback();
  }
  try {
    const { data, error } = await db
      .from("services")
      .select("slug, name, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) {
      console.warn("[quote] services query failed or empty; using the static service list", error?.message);
      return fallback();
    }
    return data.map((r) => {
      const site = siteServices.find((s) => s.slug === r.slug);
      return { slug: r.slug, name: r.name, blurb: site?.blurb, icon: site?.icon };
    });
  } catch {
    return fallback();
  }
}
