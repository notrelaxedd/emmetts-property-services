import { Button } from "@/components/ui/button";
import { BookLink } from "@/components/site/book-link";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// TODO: reviews are placeholders until real ones are added in lib/content.ts (content.reviews.items).
// Placeholder cards get a dashed outline so they're easy to spot before launch.

export function Reviews() {
  const { reviews } = content;

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="relative isolate overflow-hidden py-20 md:py-28">
      <Diagonal
        className="bg-gray-light"
        sm="polygon(0 22%, 100% 10%, 100% 100%, 0 100%)"
        md="polygon(0 38%, 100% 10%, 100% 100%, 0 100%)"
      />
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 90%, 100% 97%, 100% 100%, 0 100%)"
        md="polygon(0 64%, 42% 100%, 0 100%)"
      />

      <div className="container">
        <Headline id="reviews-title" lines={reviews.headline} />

        {/* Cards step down left to right, tracing the same diagonal as the panels. */}
        <ul className="mt-12 grid gap-5 md:grid-cols-3 md:items-start">
          {reviews.items.map((review, i) => {
            const isPlaceholder = review.quote.startsWith("PLACEHOLDER");
            return (
              <Reveal as="li" key={i} delay={i * 110} className={cn(i === 1 && "md:mt-12", i === 2 && "md:mt-24")}>
                <figure
                  className={cn(
                    "flex h-full flex-col rounded-[2rem] bg-white p-8",
                    isPlaceholder && "border-2 border-dashed border-gray-panel",
                  )}
                >
                  <span aria-hidden="true" className="font-display text-7xl leading-[0.6] text-brand-green">
                    &ldquo;
                  </span>
                  <blockquote className="mt-4 text-lg leading-relaxed text-ink">{review.quote}</blockquote>
                  <figcaption className="mt-6 border-t border-gray-light pt-4">
                    <span className="block font-semibold text-ink">{review.name}</span>
                    <span className="text-sm text-ink-muted">{review.detail}</span>
                  </figcaption>
                </figure>
              </Reveal>
            );
          })}
        </ul>

        <div className="mt-14 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
          <Button asChild variant="cta" size="cta">
            <BookLink>{content.cta.book}</BookLink>
          </Button>
          <p className="font-medium text-ink-body">
            or call{" "}
            <a href={siteConfig.phone.href} className="whitespace-nowrap font-semibold text-ink underline decoration-brand-green decoration-2 underline-offset-4 hover:text-brand-green-dark">
              {siteConfig.phone.display}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
