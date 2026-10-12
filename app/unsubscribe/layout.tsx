import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { MobileCallBar } from "@/components/site/mobile-call-bar";

/** Same brand chrome as the marketing pages (this route lives outside the (marketing) group). */
export default function UnsubscribeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
    </>
  );
}
