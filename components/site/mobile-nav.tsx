"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Phone } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { ContactLink } from "./contact-link";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex size-12 items-center justify-center rounded-full bg-ink text-white"
          aria-label="Open menu"
        >
          <Menu className="size-6" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-[88%] flex-col border-l-0 bg-paper px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-20 sm:max-w-sm"
        // Don't yank focus back to the trigger after tapping a link; the page is scrolling to a section.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <nav aria-label="Main">
          <ul className="flex flex-col gap-1">
            {content.nav.map((item) => (
              <li key={item.href}>
                <SheetClose asChild>
                  <Link
                    href={item.href}
                    className="block py-2 font-display text-[2.75rem] uppercase leading-none text-ink transition-colors hover:text-brand-green-dark"
                  >
                    {item.label}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <Button asChild variant="cta" size="cta" className="w-full">
            <a href={siteConfig.phone.href}>
              <Phone aria-hidden="true" />
              {siteConfig.phone.display}
            </a>
          </Button>
          <SheetClose asChild>
            <Button asChild variant="cta-outline" size="cta" className="w-full">
              <ContactLink>{content.cta.contact}</ContactLink>
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
