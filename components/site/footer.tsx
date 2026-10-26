import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { Wordmark } from "./logo";
import { SeasonTrio } from "./season-glyphs";
import { Eyebrow } from "./section-heading";

/**
 * A quiet, symmetric colophon: links on one side, contact on the other, and between them the
 * badge's lower half in type (wordmark, ruled line, season marks). The closing section right above
 * already shows the full badge, so it isn't repeated here.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const cities = siteConfig.serviceArea.cities;

  return (
    <footer className="border-t border-forest/10 bg-cream text-forest-body">
      {/* Tablets: wordmark on top, links and contact side by side. Desktop: the wordmark moves to the middle. */}
      <div className="container grid gap-16 py-20 text-center md:grid-cols-2 md:gap-x-8 md:py-24 lg:grid-cols-3">
        <div className="flex flex-col items-center md:col-span-2 lg:order-2 lg:col-span-1">
          <Wordmark size="lg" />
          <SeasonTrio className="mt-6" />
          <p className="mt-6 max-w-xs">{content.footer.blurb}</p>
        </div>

        <div className="lg:order-1">
          <Eyebrow as="h2">{content.footer.linksHeading}</Eyebrow>
          <ul className="mt-5 flex flex-col items-center">
            <li>
              <Link
                href="/quote"
                className="inline-flex min-h-11 items-center font-semibold text-forest underline decoration-forest/30 decoration-1 underline-offset-[6px] transition-colors hover:decoration-forest"
              >
                {content.cta.quote}
              </Link>
            </li>
            {content.nav
              .filter((item) => item.href !== "/#contact")
              .map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-flex min-h-11 items-center transition-colors hover:text-forest">
                    {item.label}
                  </Link>
                </li>
              ))}
            <li>
              <Link href="/contact" className="inline-flex min-h-11 items-center transition-colors hover:text-forest">
                {content.cta.contact}
              </Link>
            </li>
          </ul>
        </div>

        <div className="lg:order-3">
          <Eyebrow as="h2">{content.footer.contactHeading}</Eyebrow>
          <a
            href={siteConfig.phone.href}
            className="mt-6 inline-flex min-h-11 items-center gap-2.5 font-heading text-2xl font-extrabold text-forest transition-colors hover:text-pine"
          >
            <Phone className="size-5" aria-hidden="true" strokeWidth={1.75} />
            {siteConfig.phone.display}
          </a>
          <ul className="mt-4 flex flex-col items-center gap-3">
            {siteConfig.email && (
              <li className="flex items-start gap-2">
                <Mail className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
                <a href={`mailto:${siteConfig.email}`} className="break-all hover:text-forest">
                  {siteConfig.email}
                </a>
              </li>
            )}
            {siteConfig.hours && (
              <li className="flex items-start gap-2">
                <Clock className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
                <span>{siteConfig.hours}</span>
              </li>
            )}
            <li className="flex max-w-xs items-start gap-2">
              <MapPin className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
              <span>
                <span className="sr-only">{content.footer.areaHeading}: </span>
                {siteConfig.serviceArea.summary}
                {cities.length > 1 && <span className="block text-forest-muted">{cities.join(" · ")}</span>}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* pb-callbar keeps the last line clear of the fixed mobile call bar. */}
      <div className="pb-callbar border-t border-forest/10">
        <div className="container flex flex-col items-center gap-1 py-7 text-sm text-forest-muted sm:flex-row sm:justify-between">
          <p>
            &copy; {year} {siteConfig.name}
          </p>
          <p>{siteConfig.altName} · Northeast Ohio</p>
        </div>
      </div>
    </footer>
  );
}
