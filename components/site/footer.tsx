import Image from "next/image";
import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { Diagonal } from "./diagonal";

export function SiteFooter() {
  const year = new Date().getFullYear();
  const cities = siteConfig.serviceArea.cities;

  return (
    <footer className="on-dark relative isolate overflow-hidden bg-ink text-white/80">
      <Diagonal
        className="bg-white/[0.05]"
        sm="polygon(55% 0, 100% 0, 100% 100%, 20% 100%)"
        md="polygon(62% 0, 100% 0, 100% 100%, 48% 100%)"
      />

      <div className="container grid gap-12 py-16 md:grid-cols-12 md:py-20">
        <div className="md:col-span-5 lg:col-span-4">
          <Image
            src="/logo.png"
            alt={`${siteConfig.name} logo`}
            width={440}
            height={384}
            className="h-40 w-auto md:h-52"
          />
          <p className="mt-6 max-w-sm">{content.footer.blurb}</p>
        </div>

        <div className="md:col-span-3 lg:col-span-3">
          <h2 className="font-display text-xl uppercase text-white">{content.footer.linksHeading}</h2>
          <ul className="mt-4 space-y-2">
            <li>
              <Link href="/quote" className="font-semibold text-brand-green transition-colors hover:text-white">
                {content.cta.quote}
              </Link>
            </li>
            {content.nav
              .filter((item) => item.href !== "/#contact")
              .map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors hover:text-brand-green">
                    {item.label}
                  </Link>
                </li>
              ))}
            <li>
              <Link href="/contact" className="transition-colors hover:text-brand-green">
                Contact us
              </Link>
            </li>
          </ul>
        </div>

        <div className="md:col-span-4 lg:col-span-5">
          <h2 className="font-display text-xl uppercase text-white">{content.footer.contactHeading}</h2>
          <a
            href={siteConfig.phone.href}
            className="mt-4 inline-flex items-center gap-3 font-display text-[2.5rem] leading-none text-brand-green transition-colors hover:text-white md:text-5xl"
          >
            <Phone className="size-7" aria-hidden="true" strokeWidth={2.5} />
            {siteConfig.phone.display}
          </a>
          <ul className="mt-6 space-y-3">
            {siteConfig.email && (
              <li className="flex items-start gap-3">
                <Mail className="mt-1 size-5 shrink-0 text-brand-green" aria-hidden="true" />
                <a href={`mailto:${siteConfig.email}`} className="hover:text-brand-green">
                  {siteConfig.email}
                </a>
              </li>
            )}
            {siteConfig.hours && (
              <li className="flex items-start gap-3">
                <Clock className="mt-1 size-5 shrink-0 text-brand-green" aria-hidden="true" />
                <span>{siteConfig.hours}</span>
              </li>
            )}
            <li className="flex items-start gap-3">
              <MapPin className="mt-1 size-5 shrink-0 text-brand-green" aria-hidden="true" />
              <span>
                <span className="sr-only">{content.footer.areaHeading}: </span>
                {siteConfig.serviceArea.summary}
                {cities.length > 1 && <span className="block text-white/60">{cities.join(" · ")}</span>}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* pb-callbar keeps the last line clear of the fixed mobile call bar (and keeps the footer black under it). */}
      <div className="pb-callbar border-t border-white/10">
        <div className="container flex flex-col gap-2 py-6 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} {siteConfig.name}
          </p>
          <p>{siteConfig.altName} · Northeast Ohio</p>
        </div>
      </div>
    </footer>
  );
}
