import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { QuoteForm } from "@/components/quote/quote-form";
import { loadQuoteServices } from "@/components/quote/services-data";
import { opsConfig } from "@/lib/config";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Get a Quote",
  description:
    "Get a free quote from Emmett's Property Services for lawn mowing, fall cleanup, leaf removal, gutter cleaning, and snow removal in Northeast Ohio and the west-side Cleveland suburbs.",
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
    <section aria-labelledby="quote-title" className="relative isolate overflow-hidden bg-gray-light py-12 md:py-24">
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 0, 100% 0, 100% 4%, 0 10%)"
        md="polygon(0 0, 40% 0, 24% 100%, 0 100%)"
      />

      <div className="container grid items-start gap-10 lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-5 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
          <Headline as="h1" id="quote-title" lines={quote.headline} />
          <p className="mt-6 max-w-md text-lead text-ink-body">{quote.body}</p>

          {/* On phones this would push the form below the fold; the thanks page repeats it anyway. */}
          <h2 className="mt-10 hidden font-display text-xl uppercase text-ink lg:block">{quote.steps.heading}</h2>
          <ol className="mt-4 hidden space-y-3 lg:block">
            {quote.steps.items.map((item, i) => (
              <li key={item} className="flex items-start gap-3 font-medium text-ink-body">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-green font-display text-base text-ink"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">{item}</span>
              </li>
            ))}
          </ol>

          <a
            href={siteConfig.phone.href}
            className="mt-10 hidden items-center gap-3 font-semibold text-ink hover:text-brand-green-dark lg:inline-flex"
          >
            <Phone className="size-5 text-brand-green-dark" aria-hidden="true" strokeWidth={2.5} />
            {siteConfig.phone.display}
          </a>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-[2rem] bg-white p-6 shadow-[0_40px_80px_-48px_rgb(11_11_11/0.35)] sm:p-10">
            <QuoteForm
              services={services}
              defaultService={defaultService}
              verifyAddress={opsConfig.geocoder !== "none"}
              turnstileSiteKey={opsConfig.turnstileSiteKey}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
