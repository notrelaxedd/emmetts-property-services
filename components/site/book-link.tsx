"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

type BookLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & { service?: string };

/**
 * Link to the booking form. On /book it jumps within the page; everywhere else it goes to the
 * form section on the home page. Pass `service` to preselect it in the dropdown.
 */
export const BookLink = forwardRef<HTMLAnchorElement, BookLinkProps>(function BookLink({ service, ...props }, ref) {
  const pathname = usePathname();
  const query = service ? `?service=${encodeURIComponent(service)}` : "";
  const href = pathname === "/book" ? `/book${query}#book` : `/${query}#book`;
  return <Link ref={ref} href={href} {...props} />;
});
