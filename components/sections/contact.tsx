import { Check, Clock, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Headline } from "@/components/site/headline";
import { SeasonTrio } from "@/components/site/season-glyphs";
import { Eyebrow } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

type ContactSectionProps = {
  headingLevel?: "h1" | "h2";
  eyebrow?: string;
  headline?: readonly string[];
  body?: string;
};

/** The /contact page body: the phone number framed in the badge's ring, then what to have handy. */
export function ContactSection({
  headingLevel = "h2",
  eyebrow = content.contactPage.eyebrow,
  headline = content.contact.headline,
  body = content.contact.body,
}: ContactSectionProps) {
  const { contact } = content;
  // Keep the outline in order whether this is the page's h1 or a section further down.
  const SubHeading = headingLevel === "h1" ? "h2" : "h3";

  return (
    <section id="contact" aria-labelledby="contact-title" className="py-20 md:py-28">
      <div className="container flex flex-col items-center text-center">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Headline as={headingLevel} id="contact-title" lines={headline} className="mt-6" />
        <p className="mt-6 max-w-lg text-lead text-forest-body">{body}</p>

        {/* The phone number is the whole point of this page, so it sits inside the ring. */}
        <div className="relative mt-14 flex aspect-square w-full max-w-[21rem] flex-col items-center justify-center rounded-full border-[1.5px] border-forest px-8 sm:max-w-[24rem]">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.26em] text-forest">{contact.callPrompt}</p>
          <a
            href={siteConfig.phone.href}
            className="mt-4 whitespace-nowrap font-heading text-[1.625rem] font-extrabold leading-none text-forest transition-colors hover:text-pine sm:text-[2rem]"
          >
            {siteConfig.phone.display}
          </a>
          <Button asChild variant="cta" size="cta" className="mt-7">
            <a href={siteConfig.phone.href}>
              <Phone aria-hidden="true" />
              {content.cta.callShort}
            </a>
          </Button>
          <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/2 bg-cream px-3.5">
            <SeasonTrio />
          </span>
        </div>

        <div className="mt-20 grid w-full max-w-3xl gap-14 border-t border-forest/10 pt-14 md:grid-cols-2 md:gap-10">
          <div>
            <SubHeading className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-forest">
              {contact.handyHeading}
            </SubHeading>
            <ul className="mt-5 flex flex-col items-center gap-3">
              {contact.handy.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-forest-body">
                  <Check className="size-4 shrink-0 text-forest" strokeWidth={2} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SubHeading className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-forest">
              {contact.areaHeading}
            </SubHeading>
            <ul className="mt-5 flex flex-col items-center gap-3 text-forest-body">
              <li className="flex max-w-xs items-start gap-2.5">
                <MapPin className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
                <span>{siteConfig.serviceArea.summary}</span>
              </li>
              {siteConfig.email && (
                <li className="flex items-start gap-2.5">
                  <Mail className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
                  <a href={`mailto:${siteConfig.email}`} className="break-all hover:text-forest">
                    {siteConfig.email}
                  </a>
                </li>
              )}
              {siteConfig.hours && (
                <li className="flex items-start gap-2.5">
                  <Clock className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" strokeWidth={1.75} />
                  <span>{siteConfig.hours}</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
