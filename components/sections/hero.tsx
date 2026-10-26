import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, Check, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Headline } from "@/components/site/headline";
import { RingPhoto } from "@/components/site/ring-photo";
import { SeasonTrio } from "@/components/site/season-glyphs";
import { Eyebrow } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * The badge, unfolded top to bottom: the scene in its ring (with the season marks at its foot),
 * the letterspaced line, then the heavy wordmark-style headline and the one loud action.
 */
export function Hero() {
  const { hero } = content;

  return (
    <section aria-labelledby="hero-title" className="pb-4 pt-8 md:pb-8 md:pt-12 [@media(max-height:820px)]:pt-6">
      <div className="container flex flex-col items-center text-center">
        <RingPhoto
          src={hero.image.src}
          alt={hero.image.alt}
          priority
          draw
          position="38% 32%"
          sizes="(min-width: 768px) 256px, 208px"
          // Smaller on short screens (small phones, 720-800px laptops) so the quote button still lands in the first screen.
          className="w-52 md:w-64 [@media(max-height:760px)]:w-40 md:[@media(max-height:820px)]:w-48"
          ornament={<SeasonTrio />}
        />

        <div className="hero-fade mt-10 [@media(max-height:820px)]:mt-8" style={delay(300)}>
          <Eyebrow>
            <span className="flex flex-col items-center gap-1.5 sm:flex-row sm:gap-0">
              <span>{hero.kicker.name}</span>
              <span aria-hidden="true" className="hidden sm:inline">
                &nbsp;&middot;&nbsp;
              </span>
              <span>{hero.kicker.place}</span>
            </span>
          </Eyebrow>
        </div>

        <Headline as="h1" id="hero-title" size="hero" lines={hero.headline} animated className="mt-5 md:mt-6" />

        <p className="hero-fade mt-6 max-w-[36rem] text-[1.0625rem] leading-relaxed text-forest-body sm:text-lead md:max-w-[42rem]" style={delay(420)}>
          {hero.body}
        </p>

        {/* One loud action: the quote form. Calling stays available below, just quieter. */}
        <div className="hero-fade mt-8 flex flex-col items-center gap-4 md:mt-10" style={delay(520)}>
          <Button asChild variant="cta" size="cta">
            <Link href="/quote">
              {content.cta.quote}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <p className="text-[0.9375rem] text-forest-muted">{hero.quoteNote}</p>
        </div>

        <div className="hero-fade mt-16 w-full max-w-3xl border-t border-forest/10 pt-12 md:mt-20" style={delay(620)}>
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.24em] text-forest">{hero.quickStartLabel}</p>
          <ul className="mt-5 flex flex-wrap justify-center gap-2.5">
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

          <ul
            className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-2 text-[0.9375rem] text-forest-body"
            aria-label={hero.trustLabel}
          >
            {hero.trust.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="size-4 shrink-0 text-forest" strokeWidth={2} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[0.9375rem] text-forest-muted">
            {content.cta.callAlt}{" "}
            <a
              href={siteConfig.phone.href}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-forest underline decoration-forest/30 decoration-1 underline-offset-[6px] transition-colors hover:decoration-forest"
            >
              <Phone className="size-4" aria-hidden="true" strokeWidth={1.75} />
              {siteConfig.phone.display}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
