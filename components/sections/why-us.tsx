import Image from "next/image";
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

/**
 * The story on the left, the three reasons as ruled rows on the right: reading copy stays left-aligned.
 * Under both, a strip of real photos of the crew at work: proof for "Real work". Phones scroll it sideways.
 */
export function WhyUs() {
  const { whyUs } = content;

  return (
    <section id="why-us" aria-labelledby="why-us-title" className="bg-sage py-24 md:py-32">
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

      <div className="container mt-16 md:mt-20">
        <p className="font-heading text-xs font-semibold uppercase tracking-[0.24em] text-forest">{whyUs.gallery.label}</p>
        <ul
          aria-label={whyUs.gallery.label}
          className="-mx-5 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-6 md:gap-5 md:overflow-visible md:px-0 md:pb-0"
        >
          {whyUs.gallery.items.map((photo, i) => (
            <Reveal
              as="li"
              key={photo.src}
              delay={i * 70}
              className="w-40 shrink-0 snap-start border-[1.5px] border-forest p-1.5 md:w-auto"
            >
              {/* Same idea as the ring: a thin forest line with a band of breathing room, then the photo. */}
              <div className="relative aspect-[3/4] overflow-hidden bg-cream">
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  sizes="(min-width: 1280px) 190px, (min-width: 768px) 15vw, 160px"
                  className="object-cover"
                />
              </div>
            </Reveal>
          ))}
        </ul>
        <p className="mt-4 text-[0.9375rem] text-forest-muted">{whyUs.gallery.note}</p>
      </div>
    </section>
  );
}
