import type { Metadata } from "next";
import { Check, Phone } from "lucide-react";
import { Headline } from "@/components/site/headline";
import { IconBadge } from "@/components/site/icons";
import { Eyebrow } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Payment Received",
  description: "Thanks! Your payment went through and we'll be in touch to schedule your job.",
  robots: { index: false, follow: false },
};

export default function QuotePaidPage() {
  const { paid } = content.quote;

  return (
    <section aria-labelledby="paid-title" className="py-20 md:py-28">
      <div className="container flex flex-col items-center text-center">
        <IconBadge icon={Check} size="lg" />
        <Eyebrow className="mt-8">{paid.eyebrow}</Eyebrow>
        <Headline as="h1" id="paid-title" lines={paid.headline} accentLine={1} className="mt-6" />
        <p className="mt-6 max-w-xl text-lead text-forest-body">{paid.body}</p>
        <p className="mt-4 max-w-xl text-forest-body">{paid.callPrompt}</p>

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
