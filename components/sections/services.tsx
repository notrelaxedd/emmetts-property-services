import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { ServiceBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { SeasonMark, seasonMarks } from "@/components/site/season-glyphs";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { services, type Service } from "@/lib/services";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

function priceFor(slug: string) {
  return siteConfig.pricing.from[slug] ?? null;
}

/** The in-season service: a thin-ruled panel, the pitch and its quote button beside a ruled list of what's included. */
function FeaturedService({ service }: { service: Service }) {
  const price = priceFor(service.slug);
  const season = seasonMarks[service.season];
  return (
    // Edge to edge on phones: the quote button can't wrap, and at 320px it needs the full width.
    <article className="-mx-5 grid gap-10 border-y border-forest/20 bg-cream px-5 py-9 sm:mx-0 sm:border-x sm:p-10 md:grid-cols-12 md:gap-8 lg:p-14">
      <div className="md:col-span-7">
        <p className={cn("flex items-center gap-2.5 font-heading text-xs font-semibold uppercase tracking-[0.26em]", season.text)}>
          <SeasonMark mark={season.mark} className="size-4" />
          {content.services.featuredLabel}
        </p>
        <h3 className="mt-5 font-heading text-[clamp(1.75rem,3.6vw,2.5rem)] font-extrabold uppercase leading-none text-forest">
          {service.title}
        </h3>
        <p className="mt-5 max-w-md text-forest-body">{service.blurb}</p>
        {price && <p className="mt-4 font-semibold text-forest">From {price}</p>}

        <div className="mt-9 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
          <Button asChild variant="cta" size="cta" className="w-full sm:w-auto">
            <Link href={`/quote?service=${service.slug}`}>
              {content.cta.quote}
              <span className="sr-only">: {service.title}</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <CallLink prompt={content.cta.callAlt} />
        </div>
      </div>

      {service.includes && (
        <div className="md:col-span-5 md:self-center">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.26em] text-forest-muted">
            {content.services.includesLabel}
          </p>
          <ul className="mt-3 border-t border-forest/20">
            {service.includes.map((item) => (
              <li key={item} className="border-b border-forest/20 py-3.5 font-medium text-forest">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** One ruled row. The whole row opens the quote form with this service ticked, and focus outlines all of it. */
function ServiceRow({ service, index }: { service: Service; index: number }) {
  const price = priceFor(service.slug);
  return (
    <Reveal
      as="li"
      delay={index * 70}
      className="group relative grid grid-cols-[3rem_1fr] gap-x-5 gap-y-1.5 border-b border-forest/20 py-7 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-[3px] has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-forest lg:grid-cols-[3rem_minmax(0,17rem)_minmax(0,1fr)_auto] lg:items-center lg:gap-x-8"
    >
      <ServiceBadge icon={service.icon} className="row-span-3 lg:row-span-1" />
      <h3 className="font-heading text-[0.9375rem] font-bold uppercase leading-snug tracking-[0.08em] text-forest decoration-1 underline-offset-[5px] group-hover:underline">
        {service.title}
      </h3>
      <p className="text-forest-body">
        {service.blurb}
        {price && <span className="mt-1 block font-semibold text-forest">From {price}</span>}
      </p>
      <Link
        href={`/quote?service=${service.slug}`}
        className="inline-flex min-h-11 w-fit items-center gap-2 whitespace-nowrap font-heading text-xs font-semibold uppercase tracking-[0.2em] text-forest focus-visible:outline-none after:absolute after:inset-0 after:content-['']"
      >
        {content.services.linkLabel}
        <span className="sr-only">: {service.title}</span>
        <ArrowRight
          className="size-4 transition-transform duration-300 ease-out-quart group-hover:translate-x-1"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </Link>
    </Reveal>
  );
}

export function Services() {
  const featured = services.find((s) => s.slug === content.services.featuredSlug) ?? services[0];
  const rest = services.filter((s) => s.slug !== featured.slug);

  return (
    <section id="services" aria-labelledby="services-title" className="bg-sage py-24 md:py-32">
      <div className="container">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <SectionHeading id="services-title" align="start" eyebrow={content.services.eyebrow} lines={content.services.headline} />
          <p className="max-w-md text-lead text-forest-body">{content.services.intro}</p>
        </div>

        <Reveal className="mt-14 md:mt-16">
          <FeaturedService service={featured} />
        </Reveal>

        <div className="mt-16 md:mt-20">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.26em] text-forest-muted">
            {content.services.moreLabel}
          </p>
          <ul className="mt-4 border-t border-forest/40">
            {rest.map((service, i) => (
              <ServiceRow key={service.slug} service={service} index={i} />
            ))}
          </ul>
        </div>

        {siteConfig.pricing.note && <p className="mt-10 font-medium text-forest">{siteConfig.pricing.note}</p>}
      </div>
    </section>
  );
}
