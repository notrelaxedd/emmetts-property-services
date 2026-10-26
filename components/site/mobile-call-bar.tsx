"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Phone } from "lucide-react";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const pill =
  "flex h-12 items-center justify-center gap-2 rounded-full font-heading text-[0.8125rem] font-semibold uppercase tracking-[0.16em] active:scale-[0.98]";
// Filled cream for the quote; calling is a thin cream outline so it never outshouts it.
const filled = "bg-cream text-forest";
const outlined = "border border-cream/60 text-cream";

/**
 * Phones only: the free quote is one thumb-tap away from any scroll position, with calling beside it.
 * On the quote pages themselves the quote button would point at the page you're on, so it's just Call.
 */
export function MobileCallBar() {
  const onQuotePage = usePathname()?.startsWith("/quote") ?? false;

  return (
    <div className="on-dark fixed inset-x-0 bottom-0 z-sticky border-t border-cream/10 bg-forest px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 md:hidden">
      <div className={onQuotePage ? "grid" : "grid grid-cols-[1.6fr_1fr] gap-2.5"}>
        {!onQuotePage && (
          <Link href="/quote" className={cn(pill, filled)}>
            {content.mobileBar.quote}
            <ArrowRight className="size-4" aria-hidden="true" strokeWidth={2} />
          </Link>
        )}
        <a href={siteConfig.phone.href} className={cn(pill, onQuotePage ? filled : outlined)}>
          <Phone className="size-4" aria-hidden="true" strokeWidth={2} />
          <span>
            {onQuotePage ? content.mobileBar.callNow : content.mobileBar.call}
            <span className="sr-only"> {siteConfig.phone.display}</span>
          </span>
        </a>
      </div>
    </div>
  );
}
