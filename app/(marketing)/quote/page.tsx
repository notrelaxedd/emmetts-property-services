import type { Metadata } from "next";
import { CallLink } from "@/components/site/call-link";
import { Headline } from "@/components/site/headline";
import { Eyebrow } from "@/components/site/section-heading";
import { QuoteForm } from "@/components/quote/quote-form";
import { loadQuoteServices } from "@/components/quote/services-data";
import { opsConfig } from "@/lib/config";
import { content } from "@/lib/content";

export const metadata: Metadata = {
  title: "Get a Quote",
  description:
    "Get a free quote from Emmett's Property Services for lawn mowing, fall cleanup, leaf removal, gutter cleaning, and snow removal for homes, businesses, and HOAs in Rocky River, Westlake, Bay Village, and Lakewood.",
  alternates: { canonical: "/quote" },
  openGraph: { url: "/quote" },
};

// Services come from Supabase per request, and `?service=` / utm_* change what renders.
export const dynamic = "force-dynamic";

export default async function QuotePage({ searchParams }: { searchParams: { service?: string | string[] } }) {
  const services = await loadQuoteServices();
  const requested = Array.isArray(searchParams.service) ? searchParams.service[0] : searchParams.service;
  const defaultService = requested && services.some((s) => s.slug === requested) ? requested : undefined;
  const { quote } = content;

  return (
    <section aria-labelledby="quote-title" className="py-14 md:py-20 lg:py-24">
      <div className="container grid items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
        {/* Left-aligned like the home page hero, so it lines up with the form; a sticky column beside it on wide screens. */}
        <div className="lg:sticky lg:top-[calc(var(--header-h)+2.5rem)] lg:col-span-5">
          <Eyebrow align="start">{quote.eyebrow}</Eyebrow>
          <Headline as="h1" id="quote-title" lines={quote.headline} className="mt-6" />
          <p className="mt-6 max-w-md text-lead text-forest-body">{quote.body}</p>

          {/* On phones this would push the form below the fold; the thanks page repeats it anyway. */}
          <div className="mt-12 hidden border-t border-forest/10 pt-10 lg:block">
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-forest">{quote.steps.heading}</h2>
            <ol className="mt-6 space-y-5">
              {quote.steps.items.map((item, i) => (
                <li key={item} className="relative flex items-start gap-4 text-forest-body">
                  {/* A hairline from this ring to the next, like the steps on the home page; drawn per gap so
                      it ends at the last ring however the text wraps. */}
                  {i < quote.steps.items.length - 1 && (
                    <span aria-hidden="true" className="absolute -bottom-5 left-4 top-8 w-px -translate-x-1/2 bg-forest/20" />
                  )}
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-forest bg-cream font-heading text-sm font-semibold text-forest"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-1">{item}</span>
                </li>
              ))}
            </ol>

            <CallLink prompt={content.cta.callAlt} className="mt-10" />
          </div>
        </div>

        {/* A thin-ruled white sheet on the cream page, like the featured service panel on the home page. */}
        <div className="border border-forest/15 bg-white px-5 py-8 sm:p-10 lg:col-span-7">
          <QuoteForm
            services={services}
            defaultService={defaultService}
            verifyAddress={opsConfig.geocoder !== "none"}
            turnstileSiteKey={opsConfig.turnstileSiteKey}
          />
        </div>
      </div>
    </section>
  );
}
