import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Quote Request Received",
  description: "Thanks! Your quote request is in and your price is on the way.",
  alternates: { canonical: "/quote/thanks" },
  robots: { index: false, follow: true },
};

export default function QuoteThanksPage() {
  const { thanks } = content.quote;

  return (
    <section aria-labelledby="thanks-title" className="relative isolate overflow-hidden bg-gray-light py-16 md:py-28">
      <Diagonal className="bg-gray-mid" sm="polygon(0 0, 100% 0, 100% 5%, 0 12%)" md="polygon(0 0, 40% 0, 24% 100%, 0 100%)" />

      <div className="container grid items-start gap-10 lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-6">
          <CheckCircle2 className="size-14 text-brand-green-dark" aria-hidden="true" strokeWidth={2.25} />
          <Headline as="h1" id="thanks-title" lines={thanks.headline} className="mt-6" />
          <p className="mt-6 max-w-md text-lead text-ink-body">{thanks.body}</p>
          <Button asChild variant="cta-outline" size="cta-sm" className="mt-8">
            <Link href="/">{thanks.back}</Link>
          </Button>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-[2rem] bg-white p-7 sm:p-10">
            <h2 className="font-display text-2xl uppercase text-ink">{thanks.nextHeading}</h2>
            <ol className="mt-5 space-y-4">
              {thanks.next.map((item, i) => (
                <li key={item} className="flex items-start gap-3 font-medium text-ink-body">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-green font-display text-base text-ink"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ol>

            <div className="on-dark mt-8 rounded-2xl bg-ink p-6 text-white">
              <p className="font-semibold text-white/80">{thanks.soonerPrompt}</p>
              <a
                href={siteConfig.phone.href}
                className="mt-2 flex items-center gap-3 font-display text-4xl leading-none text-brand-green transition-colors hover:text-white"
              >
                <Phone className="size-7 shrink-0" aria-hidden="true" strokeWidth={2.5} />
                {siteConfig.phone.display}
              </a>
              <Button asChild variant="cta-green" size="cta" className="mt-5 w-full sm:w-auto">
                <a href={siteConfig.phone.href}>
                  <Phone aria-hidden="true" />
                  {content.cta.callShort}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
