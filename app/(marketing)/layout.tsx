import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { LocalBusinessJsonLd } from "@/components/site/json-ld";
import { MobileCallBar } from "@/components/site/mobile-call-bar";
import { AuthHashCatcher } from "@/components/site/auth-hash-catcher";

/**
 * Marketing chrome (header, footer, call bar, JSON-LD). /admin and /crew have their own layouts.
 * `theme-badge` puts these pages on the badge's cream with a forest focus ring (see globals.css).
 */
export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="theme-badge min-h-screen bg-cream text-forest-body">
      <a
        href="#main"
        className="sr-only z-toast rounded-full bg-forest px-5 py-3 font-semibold text-cream focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
      <MobileCallBar />
      <LocalBusinessJsonLd />
      <AuthHashCatcher />
    </div>
  );
}
