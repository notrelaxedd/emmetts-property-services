import Link from "next/link";
import { ArrowRight, CalendarCheck, Leaf, ReceiptText, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { IconBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";

// In content order: scheduled maintenance, seasonal cleanups, snow removal, simple billing.
const pointIcons = [CalendarCheck, Leaf, Snowflake, ReceiptText];

/** Bigger accounts: heading and pitch like Services, then the four reasons under hairline rules and one quote button. */
export function Commercial() {
  const { commercial } = content;

  return (
    <section id="commercial" aria-labelledby="commercial-title" className="py-24 md:py-32">
      <div className="container">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <SectionHeading id="commercial-title" align="start" eyebrow={commercial.eyebrow} lines={commercial.headline} />
          <p className="max-w-md text-lead text-forest-body">{commercial.intro}</p>
        </div>

        <ul className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
          {commercial.points.map((point, i) => (
            <Reveal as="li" key={point.title} delay={i * 80} className="border-t border-forest/40 pt-7">
              <IconBadge icon={pointIcons[i] ?? CalendarCheck} />
              <h3 className="mt-6 font-heading text-[0.9375rem] font-bold uppercase tracking-[0.08em] text-forest">{point.title}</h3>
              <p className="mt-2 text-forest-body">{point.body}</p>
            </Reveal>
          ))}
        </ul>

        <div className="mt-12 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
          {/* A touch tighter on small phones so the label fits on one line. */}
          <Button
            asChild
            variant="cta"
            size="cta"
            className="w-full max-sm:px-4 max-sm:text-[0.8125rem] max-sm:tracking-[0.1em] sm:w-auto"
          >
            <Link href="/quote">
              {commercial.cta}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <CallLink prompt={commercial.callPrompt} />
        </div>
      </div>
    </section>
  );
}
