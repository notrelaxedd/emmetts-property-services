import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { MobileCallBar } from "@/components/site/mobile-call-bar";

/**
 * Same brand chrome as the marketing pages (this route lives outside the (marketing) group), so it
 * also needs their `theme-badge` cream and forest focus ring.
 */
export default function UnsubscribeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
    </div>
  );
}
