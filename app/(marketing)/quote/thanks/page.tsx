import type { Metadata } from "next";
import Link from "next/link";
import { Check, CreditCard, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Headline } from "@/components/site/headline";
import { IconBadge } from "@/components/site/icons";
import { Eyebrow } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Quote Request Received",
  description: "Thanks! Your quote request is in. We'll call you with a price and pick a day together.",
  alternates: { canonical: "/quote/thanks" },
  robots: { index: false, follow: true },
};

/**
 * Centered like /contact: the confirmation, the three steps from here, then one forest panel for people in a hurry.
 * Stripe Checkout's cancel button lands here too (?cancelled=1): that visitor gets "no charge was made" instead.
 */
export default function QuoteThanksPage({ searchParams }: { searchParams: { cancelled?: string | string[] } }) {
  const { thanks } = content.quote;
  const cancelled = searchParams.cancelled === "1";
  const view = cancelled ? thanks.cancelled : thanks;

  return (
    <section aria-labelledby="thanks-title" className="py-16 md:py-24">
      <div className="container flex flex-col items-center text-center">
        <IconBadge icon={cancelled ? CreditCard : Check} size="lg" />
        <Eyebrow className="mt-8">{view.eyebrow}</Eyebrow>
        <Headline as="h1" id="thanks-title" lines={view.headline} className="mt-6" />
        <p className="mt-6 max-w-lg text-lead text-forest-body">{view.body}</p>
        <Button asChild variant="cta-outline" size="cta-sm" className="mt-9">
          <Link href="/">{thanks.back}</Link>
        </Button>

        {!cancelled && (
          <div className="mt-20 w-full max-w-5xl border-t border-forest/10 pt-14">
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-forest">{thanks.nextHeading}</h2>
            <ol className="relative mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
              {/* A hairline linking the numbered rings, from the first ring's center to the last's (as on the home page). */}
              <span aria-hidden="true" className="absolute inset-x-[calc((100%-4rem)/6)] top-6 hidden h-px bg-forest/20 md:block" />
              {thanks.next.map((item, i) => (
                <li key={item} className="relative flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className="flex size-12 items-center justify-center rounded-full border-[1.5px] border-forest bg-cream font-heading text-lg font-semibold text-forest"
                  >
                    {i + 1}
                  </span>
                  <span className="mt-5 max-w-[16rem] text-forest-body">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* The one forest panel, inverted like the home page's closing section: cream type, cream pill. */}
        <div className="on-dark mt-20 flex w-full max-w-3xl flex-col items-center bg-forest px-5 py-12 text-cream sm:px-12 md:py-14">
          <p className="text-cream/80">{cancelled ? thanks.cancelled.prompt : thanks.soonerPrompt}</p>
          <a
            href={siteConfig.phone.href}
            className="mt-3 inline-flex min-h-11 items-center whitespace-nowrap font-heading text-[1.625rem] font-extrabold leading-none text-cream transition-colors hover:text-cream/80 sm:text-[2.25rem]"
          >
            {siteConfig.phone.display}
          </a>
          <Button
            asChild
            variant="cta"
            size="cta"
            className="mt-7 w-full bg-cream text-forest ring-offset-forest hover:bg-white hover:ring-cream sm:w-auto"
          >
            <a href={siteConfig.phone.href}>
              <Phone aria-hidden="true" />
              {content.cta.callShort}
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
