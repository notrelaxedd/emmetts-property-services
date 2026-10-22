import Link from "next/link";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { IconBadge } from "./icons";
import { LogoLockup } from "./logo";
import { MobileNav } from "./mobile-nav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-sticky border-b border-ink/10 bg-paper">
      <div className="container flex h-[var(--header-h)] items-center justify-between gap-4">
        <LogoLockup />

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1 lg:gap-3">
            {content.nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-full px-3 py-2 text-[0.95rem] font-semibold text-ink underline decoration-transparent decoration-2 underline-offset-[6px] transition-colors hover:decoration-brand-green"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 md:gap-4">
          <a
            href={siteConfig.phone.href}
            className="hidden items-center gap-2 font-semibold text-ink transition-colors hover:text-brand-green-dark lg:inline-flex"
          >
            <IconBadge icon={Phone} size="sm" />
            {siteConfig.phone.display}
          </a>
          <Button asChild variant="cta-green" size="cta-sm" className="hidden md:inline-flex">
            <Link href="/quote">{content.cta.quoteShort}</Link>
          </Button>

          {/* Phones: free quote + menu. The sticky bottom bar keeps the quote (and a call) in thumb reach too. */}
          <Button asChild variant="cta-green" size="cta-sm" className="h-12 px-5 md:hidden">
            <Link href="/quote">{content.cta.quoteShort}</Link>
          </Button>
          <div className="md:hidden">
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
