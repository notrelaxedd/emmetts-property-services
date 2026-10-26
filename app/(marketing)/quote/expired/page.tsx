import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { Headline } from "@/components/site/headline";
import { Eyebrow } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Quote Expired",
  description: "That quote link is no longer active. Call us and we'll send a fresh one.",
  robots: { index: false, follow: false },
};

export default function QuoteExpiredPage() {
  const { expired } = content.quote;

  return (
    <section aria-labelledby="expired-title" className="py-20 md:py-28">
      <div className="container flex flex-col items-center text-center">
        <Eyebrow>{expired.eyebrow}</Eyebrow>
        <Headline as="h1" id="expired-title" lines={expired.headline} className="mt-6" />
        <p className="mt-6 max-w-xl text-lead text-forest-body">{expired.body}</p>
        <Button asChild variant="cta" size="cta" className="mt-9 w-full sm:w-auto">
          <a href={siteConfig.phone.href}>
            <Phone aria-hidden="true" />
            {content.cta.call}
          </a>
        </Button>
      </div>
    </section>
  );
}
