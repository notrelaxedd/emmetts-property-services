import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { content } from "@/lib/content";

/** Right under the hero: what happens after "Get my free quote", so the form isn't a leap of faith. */
export function HowItWorks() {
  const { howItWorks } = content;

  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-24 md:py-32">
      <div className="container">
        <SectionHeading id="how-it-works-title" eyebrow={howItWorks.eyebrow} lines={howItWorks.headline} />

        {/* Phones: compact rows, number ring beside the step. Wider: three columns joined by a hairline. */}
        <ol className="relative mx-auto mt-14 grid max-w-md gap-9 md:mt-20 md:max-w-5xl md:grid-cols-3 md:gap-10">
          {/* A hairline linking the three numbered rings, from the first ring's center to the last's. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-[calc((100%-5rem)/6)] top-8 hidden h-px bg-forest/20 md:block"
          />
          {howItWorks.steps.map((step, i) => (
            <Reveal
              as="li"
              key={step.title}
              delay={i * 100}
              className="relative grid grid-cols-[3.5rem_1fr] gap-x-5 md:flex md:flex-col md:items-center md:text-center"
            >
              <span
                aria-hidden="true"
                className="row-span-2 flex size-14 items-center justify-center rounded-full border-[1.5px] border-forest bg-cream font-heading text-lg font-semibold text-forest md:size-16 md:text-xl"
              >
                {i + 1}
              </span>
              <h3 className="self-end font-heading text-[0.9375rem] font-bold uppercase tracking-[0.08em] text-forest md:mt-7 md:text-[1.0625rem]">
                {step.title}
              </h3>
              <p className="mt-1.5 text-forest-body md:mt-3 md:max-w-[17rem]">{step.body}</p>
            </Reveal>
          ))}
        </ol>

        <div className="mt-16 flex justify-center md:mt-20">
          <Button asChild variant="cta-outline" size="cta-sm">
            <Link href="/quote">
              {content.cta.quote}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
