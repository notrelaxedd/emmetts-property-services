import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { OvalPhoto } from "@/components/site/oval-photo";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

export function Hero() {
  const { hero } = content;

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Light panel slicing in from the right, a mid band, and a dark wedge in the corner. */}
      <Diagonal
        className="panel-sweep bg-gray-light"
        sm="polygon(0 64%, 100% 50%, 100% 100%, 0 100%)"
        md="polygon(58% 0, 100% 0, 100% 100%, 40% 100%)"
      />
      <Diagonal
        className="panel-sweep bg-gray-mid"
        style={delay(120)}
        sm="polygon(0 86%, 100% 72%, 100% 100%, 0 100%)"
        md="polygon(86% 0, 100% 0, 100% 100%, 68% 100%)"
      />
      <Diagonal
        className="panel-sweep bg-gray-panel"
        style={delay(240)}
        sm="polygon(100% 84%, 100% 100%, 45% 100%)"
        md="polygon(100% 44%, 100% 100%, 76% 100%)"
      />

      <div className="container grid items-center gap-12 pb-16 pt-10 md:grid-cols-12 md:gap-6 md:pb-24 md:pt-16 lg:pt-20">
        <div className="md:col-span-7 lg:col-span-7">
          <p className="hero-fade flex items-center gap-3 text-[0.9375rem] font-semibold text-ink sm:text-base" style={delay(0)}>
            <span aria-hidden="true" className="h-[3px] w-8 shrink-0 rounded-full bg-brand-green" />
            <span>
              {hero.kicker.name} <span className="whitespace-nowrap">· {hero.kicker.place}</span>
            </span>
          </p>

          <Headline as="h1" id="hero-title" size="hero" lines={hero.headline} animated accentLine={1} className="mt-5" />

          <p className="hero-fade mt-7 max-w-[34rem] text-lead text-ink-body" style={delay(420)}>
            {hero.body}
          </p>

          {/* One loud action: the quote form. Calling stays available, just quieter. */}
          <div className="hero-fade mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6" style={delay(520)}>
            <Button asChild variant="cta" size="cta">
              <Link href="/quote">
                {content.cta.quote}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-[0.9375rem] font-medium text-ink-body">{hero.quoteNote}</p>
          </div>

          <div className="hero-fade mt-7" style={delay(580)}>
            <p className="text-[0.9375rem] font-semibold text-ink">{hero.quickStartLabel}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {hero.quickStart.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/quote?service=${item.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full border-2 border-ink bg-paper/70 px-4 font-semibold text-ink transition-colors hover:border-brand-green-dark hover:bg-brand-green"
                  >
                    {item.label}
                    <span className="sr-only">: {content.quote.cta.toLowerCase()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <ul
            className="hero-fade mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem] font-medium text-ink-body"
            style={delay(640)}
            aria-label="Why neighbors hire us"
          >
            {hero.trust.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="size-4 shrink-0 text-brand-green-dark" strokeWidth={3} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <p className="hero-fade mt-6 text-[0.9375rem] text-ink-body" style={delay(700)}>
            {content.cta.callAlt}{" "}
            <a
              href={siteConfig.phone.href}
              className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-brand-green decoration-2 underline-offset-[6px] hover:text-brand-green-dark"
            >
              <Phone className="size-4" aria-hidden="true" strokeWidth={2.5} />
              {siteConfig.phone.display}
            </a>
          </p>
        </div>

        <div className="md:col-span-5 lg:col-span-5">
          <div className="relative mx-auto w-[72%] max-w-[27rem] md:w-full">
            <OvalPhoto
              src={hero.image.src}
              alt={hero.image.alt}
              priority
              position="42% 50%"
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 38vw, 72vw"
              className="oval-in w-full"
            />
            {/* The badge, slapped on like a sticker. Rotation lives on the wrapper so the fade-in's transform can't reset it. */}
            <div className="absolute -bottom-4 -right-[6%] w-[50%] rotate-[8deg] md:right-0 md:w-[44%] xl:-right-[6%]">
              <Image
                src="/logo.png"
                alt={`${siteConfig.name} badge: a mower, leaf blower, and snowblower for every season`}
                width={440}
                height={384}
                sizes="(min-width: 768px) 210px, 150px"
                className="hero-fade h-auto w-full drop-shadow-[0_16px_20px_rgb(11_11_11/0.35)]"
                style={delay(760)}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
