import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { Headline } from "@/components/site/headline";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Quote Expired",
  description: "That quote link is no longer active. Call us and we'll send a fresh one.",
  robots: { index: false, follow: false },
};

export default function QuoteExpiredPage() {
  return (
    <section aria-labelledby="expired-title" className="bg-gray-light py-16 md:py-28">
      <div className="container max-w-2xl">
        <Headline as="h1" id="expired-title" lines={["That quote", "has expired"]} className="mt-2" />
        <p className="mt-6 text-lead text-ink-body">
          Quote links stay active for a couple of weeks. This one has passed its date, or it was already paid. Give us
          a call and we&apos;ll send a fresh quote right away.
        </p>
        <Button asChild variant="cta-green" size="cta" className="mt-8 w-full sm:w-auto">
          <a href={siteConfig.phone.href}>
            <Phone aria-hidden="true" />
            {content.cta.call}
          </a>
        </Button>
      </div>
    </section>
  );
}
