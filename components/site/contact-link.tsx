"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

type ContactLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href">;

/**
 * Link to the contact details. On /contact it jumps within the page; everywhere else it goes to
 * the contact section on the home page.
 */
export const ContactLink = forwardRef<HTMLAnchorElement, ContactLinkProps>(function ContactLink(props, ref) {
  const pathname = usePathname();
  return <Link ref={ref} href={pathname === "/contact" ? "#contact" : "/#contact"} {...props} />;
});
