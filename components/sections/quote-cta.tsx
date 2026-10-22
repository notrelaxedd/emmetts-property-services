import Link from "next/link";
import { ArrowRight, Check, Clock, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

/**
 * The home page's closing section. The quote form gets the loudest treatment; the phone number
 * and contact details sit underneath for people who'd rather talk. Keeps id="contact" so every
 * "Contact" link still lands here.
 */
export function QuoteCta() {
  const { finalCta } = content;

  return (
    <section id="contact" aria-labelledby="contact-title" className="relative isolate overflow-hidden bg-gray-light py-16 md:py-28">
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 0, 100% 0, 100% 6%, 0 15%)"
        md="polygon(0 0, 46% 0, 30% 100%, 0 100%)"
      />
      <Diagonal
        className="bg-gray-panel"
        sm="polygon(0 0, 45% 0, 0 8%)"
        md="polygon(0 62%, 20% 100%, 0 100%)"
      />

      <div className="container grid items-start gap-10 lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-5">
          <Headline id="contact-title" lines={finalCta.headline} accentLine={1} />
          <p className="mt-6 max-w-md text-lead text-ink-body">{finalCta.body}</p>

          <ul className="mt-10 space-y-4 text-ink-body">
            {siteConfig.email && (
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 size-5 shrink-0 text-brand-green-dark" aria-hidden="true" />
                <a href={`mailto:${siteConfig.email}`} className="break-all hover:text-brand-green-dark">
                  {siteConfig.email}
                </a>
              </li>
            )}
            {siteConfig.hours && (
              <li className="flex items-start gap-3">
                <Clock className="mt-0.5 size-5 shrink-0 text-brand-green-dark" aria-hidden="true" />
                <span>{siteConfig.hours}</span>
              </li>
            )}
            <li className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-brand-green-dark" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-ink">{finalCta.areaHeading}</span>
                {siteConfig.serviceArea.summary}
              </span>
            </li>
          </ul>
        </div>

        <div className="lg:col-span-7">
          <div className="on-dark rounded-[2rem] bg-ink p-7 text-white shadow-[0_40px_80px_-40px_rgb(11_11_11/0.5)] sm:p-10">
            <h3 className="display text-[2.5rem] text-brand-green sm:text-[3.5rem]">{finalCta.cardHeading}</h3>

            <ul className="mt-6 space-y-3">
              {finalCta.points.map((point) => (
                <li key={point} className="flex items-center gap-3 font-medium text-white/85">
                  <Check className="size-5 shrink-0 text-brand-green" strokeWidth={3} aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>

            <Button asChild variant="cta-green" size="cta" className="mt-8 w-full sm:w-auto">
              <Link href="/quote">
                {content.cta.quote}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>

            <div className="mt-9 border-t border-white/15 pt-8">
              <p className="text-white/70">{finalCta.callPrompt}</p>
              <a
                href={siteConfig.phone.href}
                className="mt-2 inline-flex items-center gap-3 font-display text-[1.75rem] leading-none text-white transition-colors hover:text-brand-green"
              >
                <Phone className="size-6 shrink-0" aria-hidden="true" strokeWidth={2.5} />
                {siteConfig.phone.display}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
