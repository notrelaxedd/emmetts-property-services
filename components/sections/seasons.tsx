import { ArrowLink } from "@/components/site/arrow-link";
import { Reveal } from "@/components/site/reveal";
import { RingPhoto } from "@/components/site/ring-photo";
import { SeasonMark, seasonMarks } from "@/components/site/season-glyphs";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { getService } from "@/lib/services";
import { cn } from "@/lib/utils";

/**
 * The badge's three season marks, unfolded into three rings. Also carries the "one crew covers it"
 * message (its body is the intro, its list the line under it), which used to be a section of its own.
 * Phones get compact rows (small ring beside the text) so the three seasons don't stack into a tower.
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

        <ul className="mx-auto mt-14 grid max-w-6xl gap-10 md:mt-20 md:grid-cols-3 md:gap-6 lg:gap-10">
          {seasons.items.map((item, i) => {
            const season = seasonMarks[getService(item.serviceSlug)?.season ?? "spring-summer"];
            return (
              <Reveal
                as="li"
                key={item.season}
                delay={i * 110}
                className="grid grid-cols-[7rem_1fr] items-center gap-6 md:flex md:flex-col md:items-center md:gap-0 md:text-center"
              >
                <RingPhoto
                  src={item.image.src}
                  alt={item.image.alt}
                  sizes="(min-width: 1024px) 240px, (min-width: 768px) 26vw, 112px"
                  className="w-28 md:w-full md:max-w-60"
                  ornament={<SeasonMark mark={season.mark} />}
                />
                <div className="md:mt-9 md:flex md:flex-col md:items-center">
                  <p className={cn("font-heading text-xs font-semibold uppercase tracking-[0.26em]", season.text)}>{item.season}</p>
                  <h3 className="mt-2 font-heading text-xl font-extrabold uppercase text-forest md:mt-3 md:text-2xl">{item.title}</h3>
                  <p className="mt-2 max-w-xs text-forest-body md:mt-3">{item.body}</p>
                  <ArrowLink href={`/quote?service=${item.serviceSlug}`} className="mt-1 md:mt-2">
                    {seasons.linkLabel(item.title)}
                  </ArrowLink>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
