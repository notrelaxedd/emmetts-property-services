"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Menu, Phone } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { SeasonTrio } from "./season-glyphs";

// The sheet's built-in close button is its first child; restyle it to match the ringed menu button.
const closeButton =
  "[&>button:first-child]:size-11 [&>button:first-child]:top-3.5 [&>button:first-child]:border [&>button:first-child]:border-forest/25 [&>button:first-child]:bg-transparent [&>button:first-child]:text-forest [&>button:first-child:hover]:border-forest [&>button:first-child:hover]:bg-transparent [&>button:first-child:hover]:text-forest [&>button:first-child_svg]:size-5";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  // Set when a link closes the sheet: the page is navigating or scrolling to a section, so focus
  // shouldn't jump back to the trigger. Escape and the close button still return focus to it.
  const followedLink = useRef(false);
  const onLinkClick = () => {
    followedLink.current = true;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full border border-forest/25 text-forest transition-colors hover:border-forest"
          aria-label={content.menu.open}
        >
          <Menu className="size-5" aria-hidden="true" strokeWidth={1.75} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        // theme-badge: the sheet portals outside the marketing layout, so it needs the forest focus ring itself.
        // It scrolls on landscape phones and at high zoom, and skips the slide-in with reduced motion.
        className={`theme-badge flex w-[90%] flex-col overflow-y-auto overscroll-contain border-l-0 bg-cream px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-20 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-w-sm sm:px-6 ${closeButton}`}
        onCloseAutoFocus={(e) => {
          if (followedLink.current) e.preventDefault();
          followedLink.current = false;
        }}
      >
        <SheetTitle className="sr-only">{content.menu.title}</SheetTitle>
        <nav aria-label="Main">
          <ul className="border-t border-forest/10">
            {content.nav.map((item) => (
              <li key={item.href} className="border-b border-forest/10">
                <SheetClose asChild>
                  <Link
                    href={item.href}
                    onClick={onLinkClick}
                    className="block py-5 font-heading text-[1.625rem] font-extrabold uppercase leading-none text-forest transition-colors hover:text-pine"
                  >
                    {item.label}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>

        <SeasonTrio className="mt-10 self-center" />

        <div className="mt-auto flex flex-col gap-3">
          <SheetClose asChild>
            {/* A touch tighter on small phones so the full label fits the narrow sheet. */}
            <Button asChild variant="cta" size="cta" className="w-full max-sm:px-4 max-sm:text-[0.875rem] max-sm:tracking-[0.1em]">
              <Link href="/quote" onClick={onLinkClick}>
                {content.cta.quote}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </SheetClose>
          <Button asChild variant="cta-outline" size="cta" className="w-full">
            <a href={siteConfig.phone.href}>
              <Phone aria-hidden="true" />
              {siteConfig.phone.display}
            </a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
