import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { ServiceGlyph } from "@/components/site/icons";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";

/** Black band echoing the logo's three-season identity: grass, leaf, snowflake. */
export function Seasons() {
  const { seasons } = content;

  return (
    <section aria-labelledby="seasons-title" className="on-dark relative isolate overflow-hidden bg-ink py-16 text-white md:py-20">
      <Diagonal
        className="bg-white/[0.06]"
        sm="polygon(0 0, 100% 0, 100% 12%, 0 30%)"
        md="polygon(0 0, 34% 0, 22% 100%, 0 100%)"
      />

      <div className="container grid gap-12 lg:grid-cols-12 lg:items-center">
        <Headline id="seasons-title" lines={seasons.headline} className="text-white lg:col-span-4" />

        <ul className="grid gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/15 lg:col-span-8">
          {seasons.items.map((item, i) => (
            <Reveal as="li" key={item.season} delay={i * 100} className="sm:px-6 sm:first:pl-0 sm:last:pr-0 lg:px-8">
              <ServiceGlyph icon={item.icon} className="size-9 text-brand-green" />
              <p className="mt-4 text-[0.9375rem] font-semibold text-brand-green">{item.season}</p>
              <h3 className="display mt-1.5 text-[2rem] text-white">{item.title}</h3>
              <p className="mt-3 text-white/75">{item.body}</p>
              <Link href={`/quote?service=${item.serviceSlug}`} className="mt-5 inline-flex items-center gap-2 font-semibold text-white underline decoration-brand-green decoration-2 underline-offset-[6px] transition-colors hover:text-brand-green">
                Get a {item.title.toLowerCase()} quote
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
