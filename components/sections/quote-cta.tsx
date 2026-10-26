import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Clock, Mail, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

/**
 * The home page's closing section and its one forest panel: the cream badge signs off over the
 * last quote button. The phone number and contact details sit underneath for people who'd rather
 * talk. Keeps id="contact" so every "Contact" link still lands here.
 */
export function QuoteCta() {
  const { finalCta } = content;

  return (
    <section id="contact" aria-labelledby="contact-title" className="on-dark bg-forest py-24 text-cream md:py-32">
      <div className="container flex flex-col items-center text-center">
        {/* Decorative here: the heading right below says what this is. */}
        <Image src="/logo-light.png" alt="" width={960} height={839} sizes="176px" className="h-auto w-36 md:w-44" />

        <SectionHeading
          id="contact-title"
          eyebrow={finalCta.cardHeading}
          lines={finalCta.headline}
          intro={finalCta.body}
          tone="dark"
          className="mt-12 md:mt-14"
        />

        <ul className="mt-8 flex flex-col items-center gap-2 text-[0.9375rem] text-cream/85 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-7">
          {finalCta.points.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-grass-light" strokeWidth={2} aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>

        {/* Inverted on forest: cream pill, forest text, and a cream hover ring. */}
        <Button
          asChild
          variant="cta"
          size="cta"
          className="mt-10 w-full bg-cream text-forest ring-offset-forest hover:bg-white hover:ring-cream sm:w-auto"
        >
          <Link href="/quote">
            {content.cta.quote}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>

        <CallLink prompt={finalCta.callPrompt} tone="dark" className="mt-8" />

        <ul className="mt-14 w-full max-w-xl space-y-3 border-t border-cream/15 pt-10 text-cream/80">
          <li className="flex flex-col items-center gap-2">
            <span className="flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.26em] text-cream">
              <MapPin className="size-4 text-grass-light" aria-hidden="true" strokeWidth={1.75} />
              {finalCta.areaHeading}
            </span>
            <span className="text-balance">{siteConfig.serviceArea.summary}</span>
          </li>
          {siteConfig.email && (
            <li className="flex items-center justify-center gap-2">
              <Mail className="size-4 shrink-0 text-grass-light" aria-hidden="true" strokeWidth={1.75} />
              <a href={`mailto:${siteConfig.email}`} className="break-all hover:text-cream">
                {siteConfig.email}
              </a>
            </li>
          )}
          {siteConfig.hours && (
            <li className="flex items-center justify-center gap-2">
              <Clock className="size-4 shrink-0 text-grass-light" aria-hidden="true" strokeWidth={1.75} />
              <span>{siteConfig.hours}</span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
