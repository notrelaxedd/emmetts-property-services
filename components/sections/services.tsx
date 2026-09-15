import { ArrowRight, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookLink } from "@/components/site/book-link";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { ServiceBadge } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";
import { services, type Service } from "@/lib/services";
import { siteConfig } from "@/lib/site-config";

function priceFor(slug: string) {
  return siteConfig.pricing.from[slug] ?? null;
}

function FeaturedService({ service }: { service: Service }) {
  const price = priceFor(service.slug);
  return (
    <article className="on-dark relative isolate flex h-full flex-col overflow-hidden rounded-[2rem] bg-ink p-8 text-white md:p-10">
      <Diagonal className="bg-white/[0.06]" sm="polygon(38% 0, 100% 0, 100% 62%)" />
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-brand-green px-3.5 py-1.5 text-sm font-semibold text-ink">
        <Leaf className="size-4" aria-hidden="true" strokeWidth={2.5} />
        {content.services.featuredLabel}
      </span>

      <ServiceBadge icon={service.icon} size="lg" className="mt-10" />
      <h3 className="display mt-6 text-[2.75rem] text-white md:text-[3.25rem]">{service.title}</h3>
      <p className="mt-4 max-w-md text-white/80">{service.blurb}</p>

      {service.includes && (
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Includes">
          {service.includes.map((item) => (
            <li key={item} className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white">
              {item}
            </li>
          ))}
        </ul>
      )}
      {price && <p className="mt-5 font-semibold text-white">From {price}</p>}

      <div className="mt-auto pt-10">
        <Button asChild variant="cta-green" size="cta" className="w-full sm:w-auto">
          <BookLink service={service.slug}>
            Book {service.title.toLowerCase()}
            <ArrowRight aria-hidden="true" />
          </BookLink>
        </Button>
      </div>
    </article>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const price = priceFor(service.slug);
  return (
    <article className="group relative flex h-full flex-col rounded-[2rem] bg-white p-7 transition-[transform,box-shadow] duration-300 ease-out-quart hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgb(11_11_11/0.35)] has-[a:focus-visible]:ring-4 has-[a:focus-visible]:ring-brand-green-dark md:p-8">
      <div className="flex items-center gap-4">
        <ServiceBadge icon={service.icon} />
        <h3 className="display text-[1.75rem] leading-[0.9]">{service.title}</h3>
      </div>
      <p className="mt-4 text-ink-body">{service.blurb}</p>
      {price && <p className="mt-3 font-semibold text-ink">From {price}</p>}
      <BookLink
        service={service.slug}
        className="mt-auto inline-flex w-fit items-center gap-2 pt-6 font-semibold text-brand-green-dark outline-none after:absolute after:inset-0 after:rounded-[2rem] after:content-['']"
      >
        {content.services.linkLabel}
        <span className="sr-only">: {service.title}</span>
        <ArrowRight className="size-4 transition-transform duration-300 ease-out-quart group-hover:translate-x-1" aria-hidden="true" />
      </BookLink>
    </article>
  );
}

export function Services() {
  const featured = services.find((s) => s.slug === content.services.featuredSlug) ?? services[0];
  const rest = services.filter((s) => s.slug !== featured.slug);

  return (
    <section id="services" aria-labelledby="services-title" className="relative isolate overflow-hidden bg-gray-light py-20 md:py-28">
      <Diagonal className="bg-gray-mid" sm="polygon(0 0, 78% 0, 0 16%)" md="polygon(0 0, 40% 0, 0 58%)" />

      <div className="container">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
          <Headline id="services-title" lines={content.services.headline} />
          <p className="max-w-md text-lead text-ink-body">{content.services.intro}</p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
          <Reveal className="md:col-span-2 lg:col-span-1 lg:row-span-2">
            <FeaturedService service={featured} />
          </Reveal>
          {rest.map((service, i) => (
            <Reveal key={service.slug} delay={80 + i * 80}>
              <ServiceCard service={service} />
            </Reveal>
          ))}
        </div>

        {siteConfig.pricing.note && <p className="mt-8 font-medium text-ink">{siteConfig.pricing.note}</p>}
      </div>
    </section>
  );
}
