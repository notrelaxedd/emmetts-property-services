"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Phone } from "lucide-react";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

/**
 * Phones only: the free quote is one thumb-tap away from any scroll position, with calling beside it.
 * On the quote pages themselves the quote button would point at the page you're on, so it's just Call.
 */
export function MobileCallBar() {
  const onQuotePage = usePathname()?.startsWith("/quote") ?? false;

  return (
    <div className="on-dark fixed inset-x-0 bottom-0 z-sticky border-t border-white/10 bg-ink px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 md:hidden">
      <div className={onQuotePage ? "grid" : "grid grid-cols-[1.6fr_1fr] gap-2.5"}>
        {!onQuotePage && (
          <Link
            href="/quote"
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand-green font-display text-lg uppercase tracking-[0.03em] text-ink active:scale-[0.98]"
          >
            {content.mobileBar.quote}
            <ArrowRight className="size-5" aria-hidden="true" strokeWidth={2.5} />
          </Link>
        )}
        <a
          href={siteConfig.phone.href}
          className={
            onQuotePage
              ? "flex h-12 items-center justify-center gap-2 rounded-full bg-brand-green font-display text-lg uppercase tracking-[0.03em] text-ink active:scale-[0.98]"
              : "flex h-12 items-center justify-center gap-2 rounded-full border-2 border-white/80 font-display text-lg uppercase tracking-[0.03em] text-white active:scale-[0.98]"
          }
        >
          <Phone className="size-5" aria-hidden="true" strokeWidth={2.5} />
          <span>
            {onQuotePage ? content.mobileBar.callNow : content.mobileBar.call}
            <span className="sr-only"> {siteConfig.phone.display}</span>
          </span>
        </a>
      </div>
    </div>
  );
}
