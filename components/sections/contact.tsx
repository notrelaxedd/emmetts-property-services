import { Check, Clock, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { IconBadge } from "@/components/site/icons";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

type ContactSectionProps = {
  headingLevel?: "h1" | "h2";
  headline?: readonly string[];
  body?: string;
};

export function ContactSection({
  headingLevel = "h2",
  headline = content.contact.headline,
  body = content.contact.body,
}: ContactSectionProps) {
  const { contact } = content;

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
          <Headline as={headingLevel} id="contact-title" lines={headline} />
          <p className="mt-6 max-w-md text-lead text-ink-body">{body}</p>

          <h3 className="mt-10 font-display text-xl uppercase text-ink">{contact.handyHeading}</h3>
          <ul className="mt-4 space-y-3">
            {contact.handy.map((item) => (
              <li key={item} className="flex items-center gap-3 font-medium text-ink-body">
                <IconBadge icon={Check} size="sm" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* The phone number is the whole point of this section, so it gets the loudest treatment. */}
        <div className="lg:col-span-7">
          <div className="on-dark rounded-[2rem] bg-ink p-7 text-white shadow-[0_40px_80px_-40px_rgb(11_11_11/0.5)] sm:p-10">
            <p className="font-semibold text-white/80">{contact.callPrompt}</p>
            <a
              href={siteConfig.phone.href}
              className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-display text-[2.5rem] leading-none text-brand-green transition-colors hover:text-white sm:text-[3.5rem]"
            >
              <Phone className="size-8 shrink-0 sm:size-10" aria-hidden="true" strokeWidth={2.5} />
              {siteConfig.phone.display}
            </a>

            <Button asChild variant="cta-green" size="cta" className="mt-8 w-full sm:w-auto">
              <a href={siteConfig.phone.href}>
                <Phone aria-hidden="true" />
                {content.cta.callShort}
              </a>
            </Button>

            <ul className="mt-9 space-y-4 border-t border-white/15 pt-8 text-white/80">
              {siteConfig.email && (
                <li className="flex items-start gap-3">
                  <Mail className="mt-0.5 size-5 shrink-0 text-brand-green" aria-hidden="true" />
                  <a href={`mailto:${siteConfig.email}`} className="break-all hover:text-brand-green">
                    {siteConfig.email}
                  </a>
                </li>
              )}
              {siteConfig.hours && (
                <li className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-5 shrink-0 text-brand-green" aria-hidden="true" />
                  <span>{siteConfig.hours}</span>
                </li>
              )}
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-brand-green" aria-hidden="true" />
                <span>
                  <span className="block font-semibold text-white">{contact.areaHeading}</span>
                  {siteConfig.serviceArea.summary}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
