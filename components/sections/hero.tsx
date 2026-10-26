import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { Headline } from "@/components/site/headline";
import { RingPhoto } from "@/components/site/ring-photo";
import { SeasonTrio } from "@/components/site/season-glyphs";
import { Eyebrow } from "@/components/site/section-heading";
import { content } from "@/lib/content";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * The letterspaced line, the heavy wordmark-style headline and the one loud action, beside the
 * scene in its ring (season marks at its foot, like the badge). On phones the ring follows the
 * text, so the quote button, shortcuts and trust points all land in the first screen.
 */
export function Hero() {
  const { hero } = content;

  return (
    <section aria-labelledby="hero-title" className="pb-16 pt-8 md:pb-20 md:pt-14 lg:pt-16">
      <div className="container grid items-center gap-y-16 md:grid-cols-12 md:gap-x-8">
        <div className="md:col-span-7">
          <div className="hero-fade" style={delay(0)}>
            <Eyebrow align="start">
              {/* The header already names the business on phones, and the full line won't fit there. */}
              <span className="max-sm:sr-only">
                {hero.kicker.name}
                <span aria-hidden="true">&nbsp;&middot;&nbsp;</span>
              </span>
              {hero.kicker.place}
            </Eyebrow>
          </div>

          <Headline as="h1" id="hero-title" size="hero" lines={hero.headline} animated className="mt-5 md:mt-6" />

          <p className="hero-fade mt-6 max-w-[34rem] text-[1.0625rem] leading-relaxed text-forest-body sm:text-lead" style={delay(420)}>
            {hero.body}
          </p>

          {/* One loud action: the quote form. Calling stays available below, just quieter. */}
          <div className="hero-fade mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6" style={delay(520)}>
            <Button asChild variant="cta" size="cta">
              <Link href="/quote">
                {content.cta.quote}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <p className="max-w-[15rem] text-[0.9375rem] leading-snug text-forest-muted">{hero.quoteNote}</p>
          </div>

          <div className="hero-fade mt-10 max-w-[40rem] border-t border-forest/10 pt-7" style={delay(620)}>
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.24em] text-forest">{hero.quickStartLabel}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {hero.quickStart.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/quote?service=${item.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-forest/25 px-5 font-medium text-forest transition-colors hover:border-forest hover:bg-forest hover:text-cream"
                  >
                    {item.label}
                    <span className="sr-only">: {content.quote.cta.toLowerCase()}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem] text-forest-body" aria-label={hero.trustLabel}>
              {hero.trust.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-forest" strokeWidth={2} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            <CallLink prompt={content.cta.callAlt} className="mt-3" />
          </div>
        </div>

        <div className="flex justify-center md:col-span-5 md:justify-end">
          <RingPhoto
            src={hero.image.src}
            alt={hero.image.alt}
            priority
            draw
            position="38% 32%"
            sizes="(min-width: 1280px) 448px, (min-width: 768px) 38vw, 288px"
            className="w-72 md:w-full md:max-w-[28rem]"
            ornament={<SeasonTrio />}
          />
        </div>
      </div>
    </section>
  );
}
