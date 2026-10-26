import Link from "next/link";
import { ArrowRight, Award, Tag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { IconBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";

// In content order: quality work, fair prices, well reviewed.
const pointIcons = [Award, Tag, Users];

/** The story on the left, the three reasons as ruled rows on the right: reading copy stays left-aligned. */
export function WhyUs() {
  const { whyUs } = content;

  return (
    <section id="why-us" aria-labelledby="why-us-title" className="py-24 md:py-32">
      <div className="container grid gap-14 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-6">
          <SectionHeading id="why-us-title" align="start" eyebrow={whyUs.eyebrow} lines={whyUs.headline} />

          <div className="mt-8 max-w-xl space-y-4 text-lead text-forest-body">
            {whyUs.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
            <Button asChild variant="cta-outline" size="cta-sm">
              <Link href="/quote">
                {content.cta.quote}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <CallLink prompt={content.cta.callAlt} />
          </div>
        </div>

        <ul className="border-t border-forest/40 lg:col-span-5 lg:col-start-8 lg:self-center">
          {whyUs.points.map((point, i) => (
            <Reveal as="li" key={point.title} delay={i * 90} className="flex items-start gap-5 border-b border-forest/20 py-7">
              <IconBadge icon={pointIcons[i] ?? Award} />
              <div className="pt-0.5">
                <h3 className="font-heading text-[0.9375rem] font-bold uppercase tracking-[0.08em] text-forest">{point.title}</h3>
                <p className="mt-1.5 text-forest-body">{point.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
