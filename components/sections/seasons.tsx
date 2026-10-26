import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { RingPhoto } from "@/components/site/ring-photo";
import { SeasonMark, type SeasonMarkName } from "@/components/site/season-glyphs";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import type { ServiceIcon } from "@/lib/services";
import { cn } from "@/lib/utils";

// Each season gets its badge mark on the ring and a matching label color (the *-ink shades pass AA as small text).
const seasonStyle: Partial<Record<ServiceIcon, { mark: SeasonMarkName; label: string }>> = {
  sprout: { mark: "grass", label: "text-pine" },
  leaf: { mark: "maple", label: "text-maple-ink" },
  snowflake: { mark: "snow", label: "text-frost-ink" },
};

/**
 * The badge's three season marks, unfolded into three rings. Also carries the "one crew covers it"
 * message (its body is the intro, its list the line under it), which used to be a section of its own.
 */
export function Seasons() {
  const { seasons, benefits } = content;

  return (
    <section aria-labelledby="seasons-title" className="py-24 md:py-32">
      <div className="container">
        <SectionHeading id="seasons-title" eyebrow={seasons.eyebrow} lines={seasons.headline} intro={benefits.body} />

        <ul
          aria-label={benefits.headline.join(" ")}
          className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-3 font-heading text-xs font-semibold uppercase tracking-[0.18em] text-forest"
        >
          {benefits.pills.map((pill) => (
            <li key={pill} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-1.5 rounded-full border border-forest" />
              {pill}
            </li>
          ))}
        </ul>

        <ul className="mx-auto mt-16 grid max-w-6xl gap-16 md:mt-24 md:grid-cols-3 md:gap-6 lg:gap-10">
          {seasons.items.map((item, i) => {
            const style = seasonStyle[item.icon] ?? { mark: "grass", label: "text-pine" };
            return (
              <Reveal as="li" key={item.season} delay={i * 110} className="flex flex-col items-center text-center">
                <RingPhoto
                  src={item.image.src}
                  alt={item.image.alt}
                  sizes="(min-width: 1024px) 240px, (min-width: 768px) 26vw, 208px"
                  className="w-52 md:w-full md:max-w-60"
                  ornament={<SeasonMark mark={style.mark} />}
                />
                <p className={cn("mt-9 font-heading text-xs font-semibold uppercase tracking-[0.26em]", style.label)}>
                  {item.season}
                </p>
                <h3 className="mt-3 font-heading text-2xl font-extrabold uppercase text-forest">{item.title}</h3>
                <p className="mt-3 max-w-xs text-forest-body">{item.body}</p>
                <Link
                  href={`/quote?service=${item.serviceSlug}`}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-[0.9375rem] font-semibold text-forest underline decoration-forest/30 decoration-1 underline-offset-[6px] transition-colors hover:decoration-forest"
                >
                  Get a {item.title.toLowerCase()} quote
                  <ArrowRight className="size-4" aria-hidden="true" strokeWidth={1.75} />
                </Link>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
