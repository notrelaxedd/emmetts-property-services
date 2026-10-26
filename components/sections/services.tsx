import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { MapleLeaf } from "@/components/site/season-glyphs";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { services, type Service } from "@/lib/services";
import { siteConfig } from "@/lib/site-config";

function priceFor(slug: string) {
  return siteConfig.pricing.from[slug] ?? null;
}

/** The in-season service: one centered, thin-ruled panel with its own quote button. */
function FeaturedService({ service }: { service: Service }) {
  const price = priceFor(service.slug);
  return (
    <article className="border border-forest/20 bg-cream px-6 py-12 text-center sm:px-12 md:py-14">
      <p className="flex items-center justify-center gap-2.5 font-heading text-xs font-semibold uppercase tracking-[0.26em] text-maple-ink">
        <MapleLeaf className="size-4 text-maple" />
        <span className="pl-[0.26em]">{content.services.featuredLabel}</span>
      </p>
      <h3 className="mt-5 font-heading text-[clamp(1.75rem,3.6vw,2.5rem)] font-extrabold uppercase leading-none text-forest">
        {service.title}
      </h3>
      <p className="mx-auto mt-5 max-w-md text-forest-body">{service.blurb}</p>

      {service.includes && (
        <ul
          className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-3 font-heading text-xs font-semibold uppercase tracking-[0.18em] text-forest"
          aria-label={content.services.includesLabel}
        >
          {service.includes.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-1.5 rounded-full border border-forest" />
              {item}
            </li>
          ))}
        </ul>
      )}
      {price && <p className="mt-5 font-semibold text-forest">From {price}</p>}

      <div className="mt-10 flex flex-col items-center gap-3">
        <Button asChild variant="cta" size="cta" className="w-full sm:w-auto">
          <Link href={`/quote?service=${service.slug}`}>
            {content.cta.quote}
            <span className="sr-only">: {service.title}</span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <a
          href={siteConfig.phone.href}
          className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-forest-muted transition-colors hover:text-forest"
        >
          <Phone className="size-4" aria-hidden="true" strokeWidth={1.75} />
          {content.cta.callAlt} <span className="font-semibold text-forest">{siteConfig.phone.display}</span>
        </a>
      </div>
    </article>
  );
}

function ServiceItem({ service }: { service: Service }) {
  const price = priceFor(service.slug);
  return (
    <article className="group relative flex h-full flex-col items-center bg-sage px-6 py-10 text-center md:py-12 transition-colors duration-300 ease-out-quart hover:bg-cream/60 lg:px-7">
      <ServiceBadge icon={service.icon} size="lg" />
      {/* Two lines' worth of height on wide screens, so the blurbs line up across the row. */}
      <h3 className="mt-7 font-heading text-base font-bold uppercase leading-snug tracking-[0.08em] text-forest lg:min-h-[2.75em]">
        {service.title}
      </h3>
      <p className="mt-3 max-w-xs text-[0.975rem] text-forest-body">{service.blurb}</p>
      {price && <p className="mt-3 font-semibold text-forest">From {price}</p>}
      <div className="mt-auto pt-7">
        {/* Stretched link: the whole item opens the quote form with this service ticked. */}
        <Link
          href={`/quote?service=${service.slug}`}
          className="inline-flex min-h-11 items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.2em] text-forest after:absolute after:inset-0 after:content-['']"
        >
          {content.services.linkLabel}
          <span className="sr-only">: {service.title}</span>
          <ArrowRight
            className="size-4 transition-transform duration-300 ease-out-quart group-hover:translate-x-1"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </Link>
      </div>
    </article>
  );
}

export function Services() {
  const featured = services.find((s) => s.slug === content.services.featuredSlug) ?? services[0];
  const rest = services.filter((s) => s.slug !== featured.slug);

  return (
    <section id="services" aria-labelledby="services-title" className="bg-sage py-24 md:py-32">
      <div className="container">
        <SectionHeading
          id="services-title"
          eyebrow={content.services.eyebrow}
          lines={content.services.headline}
          intro={content.services.intro}
        />

        <Reveal className="mx-auto mt-16 max-w-3xl md:mt-20">
          <FeaturedService service={featured} />
        </Reveal>

        {/* 1px gaps over a forest tint draw the hairlines between items at every column count. */}
        <ul className="mx-auto mt-16 grid max-w-6xl gap-px border-y border-forest/15 bg-forest/15 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((service, i) => (
            <Reveal as="li" key={service.slug} delay={i * 80} className="bg-sage">
              <ServiceItem service={service} />
            </Reveal>
          ))}
        </ul>

        {siteConfig.pricing.note && <p className="mt-10 text-center font-medium text-forest">{siteConfig.pricing.note}</p>}
      </div>
    </section>
  );
}
