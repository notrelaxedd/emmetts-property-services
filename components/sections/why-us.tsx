import Link from "next/link";
import { ArrowRight, Award, Phone, Tag, Users } from "lucide-react";
import { IconBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

// In content order: quality work, fair prices, neighborhood reviewed.
const pointIcons = [Award, Tag, Users];

export function WhyUs() {
  const { whyUs } = content;

  return (
    <section id="why-us" aria-labelledby="why-us-title" className="bg-sage py-24 md:py-32">
      <div className="container">
        <SectionHeading id="why-us-title" eyebrow={whyUs.eyebrow} lines={whyUs.headline} />

        <div className="mx-auto mt-8 max-w-2xl space-y-4 text-center text-lead text-forest-body">
          {whyUs.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>

        <ul className="mx-auto mt-16 grid max-w-5xl gap-12 md:mt-20 md:grid-cols-3 md:gap-0 md:divide-x md:divide-forest/15">
          {whyUs.points.map((point, i) => (
            <Reveal as="li" key={point.title} delay={i * 90} className="flex flex-col items-center px-6 text-center lg:px-8">
              <IconBadge icon={pointIcons[i] ?? Award} />
              <h3 className="mt-6 font-heading text-[0.9375rem] font-bold uppercase tracking-[0.08em] text-forest">{point.title}</h3>
              <p className="mt-2 max-w-[16rem] text-forest-body">{point.body}</p>
            </Reveal>
          ))}
        </ul>

        <div className="mt-16 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-8 md:mt-20">
          <Link
            href="/quote"
            className="inline-flex min-h-11 items-center gap-2 font-heading text-[0.8125rem] font-semibold uppercase tracking-[0.18em] text-forest underline decoration-forest/30 decoration-1 underline-offset-[8px] transition-colors hover:decoration-forest"
          >
            {content.cta.quote}
            <ArrowRight className="size-4" aria-hidden="true" strokeWidth={1.75} />
          </Link>
          <span aria-hidden="true" className="hidden h-5 w-px bg-forest/20 sm:block" />
          <a
            href={siteConfig.phone.href}
            className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-forest-muted transition-colors hover:text-forest"
          >
            <Phone className="size-4" aria-hidden="true" strokeWidth={1.75} />
            {content.cta.callAlt} <span className="font-semibold text-forest">{siteConfig.phone.display}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
