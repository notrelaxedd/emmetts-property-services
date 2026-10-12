import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { LocalBusinessJsonLd } from "@/components/site/json-ld";
import { MobileCallBar } from "@/components/site/mobile-call-bar";

/** Marketing chrome (header, footer, call bar, JSON-LD). /admin and /crew have their own layouts. */
export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-toast rounded-full bg-ink px-5 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
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
    </>
  );
}
