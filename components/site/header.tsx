import Link from "next/link";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { LogoLockup } from "./logo";
import { MobileNav } from "./mobile-nav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-sticky border-b border-forest/10 bg-cream">
      <div className="container flex h-[var(--header-h)] items-center justify-between gap-4">
        <LogoLockup />

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center xl:gap-4">
            {content.nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center whitespace-nowrap px-3 font-heading text-xs font-semibold uppercase tracking-[0.18em] text-forest underline decoration-transparent decoration-1 underline-offset-[8px] transition-colors hover:decoration-forest"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 md:gap-5">
          <a
            href={siteConfig.phone.href}
            className="hidden min-h-11 items-center gap-2 text-[0.9375rem] font-medium text-forest-body transition-colors hover:text-forest xl:inline-flex"
          >
            <Phone className="size-4" aria-hidden="true" strokeWidth={1.75} />
            {siteConfig.phone.display}
          </a>
          <Button asChild variant="cta" size="cta-sm" className="hidden md:inline-flex">
            <Link href="/quote">{content.cta.quoteShort}</Link>
          </Button>

          {/* Phones: just the menu, since the sticky bottom bar keeps the quote (and a call) in thumb reach.
              Tablets get the menu too, beside the quote button, until the full nav fits. */}
          <div className="lg:hidden">
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
