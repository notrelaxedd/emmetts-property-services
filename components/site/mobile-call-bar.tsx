import { CalendarCheck, Phone } from "lucide-react";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { BookLink } from "./book-link";

/** Phones only: call and book stay one thumb-tap away from any scroll position. */
export function MobileCallBar() {
  return (
    <div className="on-dark fixed inset-x-0 bottom-0 z-sticky border-t border-white/10 bg-ink px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 md:hidden">
      <div className="grid grid-cols-[1.4fr_1fr] gap-2.5">
        <a
          href={siteConfig.phone.href}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand-green font-display text-lg uppercase tracking-[0.03em] text-ink active:scale-[0.98]"
        >
          <Phone className="size-5" aria-hidden="true" strokeWidth={2.5} />
          <span>
            {content.mobileBar.call}
            <span className="sr-only"> {siteConfig.phone.display}</span>
          </span>
        </a>
        <BookLink className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-white/80 font-display text-lg uppercase tracking-[0.03em] text-white active:scale-[0.98]">
          <CalendarCheck className="size-5" aria-hidden="true" />
          {content.mobileBar.book}
        </BookLink>
      </div>
    </div>
  );
}
