import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Headline } from "@/components/site/headline";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";

/** Right under the hero: what happens after "Get my free quote", so the form isn't a leap of faith. */
export function HowItWorks() {
  const { howItWorks } = content;

  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="on-dark relative isolate overflow-hidden bg-ink py-16 text-white md:py-20">
      <div className="container grid gap-12 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-4">
          <Headline id="how-it-works-title" lines={howItWorks.headline} accentLine={1} className="text-white" />
          <Button asChild variant="cta-green" size="cta" className="mt-8 hidden lg:inline-flex">
            <Link href="/quote">
              {content.cta.quote}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <ol className="grid gap-10 sm:grid-cols-3 sm:gap-6 lg:col-span-8 lg:gap-8">
          {howItWorks.steps.map((step, i) => (
            <Reveal as="li" key={step.title} delay={i * 100}>
              <span
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-full bg-brand-green font-display text-2xl text-ink"
              >
                {i + 1}
              </span>
              <h3 className="mt-5 font-display text-[1.75rem] uppercase leading-none text-white">{step.title}</h3>
              <p className="mt-3 text-white/75">{step.body}</p>
            </Reveal>
          ))}
        </ol>

        <Button asChild variant="cta-green" size="cta" className="w-full sm:w-auto sm:justify-self-start lg:hidden">
          <Link href="/quote">
            {content.cta.quote}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
