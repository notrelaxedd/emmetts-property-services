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

        <ol className="relative mx-auto mt-16 grid max-w-5xl gap-14 md:mt-20 md:grid-cols-3 md:gap-10">
          {/* A hairline linking the three numbered rings, from the first ring's center to the last's. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-[calc((100%-5rem)/6)] top-8 hidden h-px bg-forest/20 md:block"
          />
          {howItWorks.steps.map((step, i) => (
            <Reveal as="li" key={step.title} delay={i * 100} className="relative flex flex-col items-center text-center">
              <span
                aria-hidden="true"
                className="flex size-16 items-center justify-center rounded-full border-[1.5px] border-forest bg-cream font-heading text-xl font-semibold text-forest"
              >
                {i + 1}
              </span>
              <h3 className="mt-7 font-heading text-[1.0625rem] font-bold uppercase tracking-[0.08em] text-forest">
                {step.title}
              </h3>
              <p className="mt-3 max-w-[17rem] text-forest-body">{step.body}</p>
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
