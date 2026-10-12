import type { Metadata } from "next";
import { CheckCircle2, Phone } from "lucide-react";
import { Headline } from "@/components/site/headline";
import { Button } from "@/components/ui/button";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Payment Received",
  description: "Thanks! Your payment went through and we'll be in touch to schedule your job.",
  robots: { index: false, follow: false },
};

export default function QuotePaidPage() {
  return (
    <section aria-labelledby="paid-title" className="bg-gray-light py-16 md:py-28">
      <div className="container max-w-2xl">
        <CheckCircle2 className="size-12 text-brand-green-dark" aria-hidden="true" strokeWidth={2.25} />
        <Headline as="h1" id="paid-title" lines={["Payment", "received"]} accentLine={1} className="mt-6" />
        <p className="mt-6 text-lead text-ink-body">
          Thank you! Your payment went through and your spot is saved. We&apos;ll be in touch soon to schedule your job, and a
          receipt from Stripe is on its way to your email.
        </p>
        <p className="mt-4 text-ink-body">Need to change something or have a question? Give us a call.</p>

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
