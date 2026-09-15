import { Phone } from "lucide-react";
import { BookingForm } from "@/components/booking/booking-form";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

type BookingSectionProps = {
  headingLevel?: "h1" | "h2";
  headline?: readonly string[];
  body?: string;
};

export function BookingSection({
  headingLevel = "h2",
  headline = content.booking.headline,
  body = content.booking.body,
}: BookingSectionProps) {
  const { booking } = content;

  return (
    <section id="book" aria-labelledby="book-title" className="relative isolate overflow-hidden bg-gray-light py-16 md:py-28">
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 0, 100% 0, 100% 6%, 0 15%)"
        md="polygon(0 0, 46% 0, 30% 100%, 0 100%)"
      />
      <Diagonal
        className="bg-gray-panel"
        sm="polygon(0 0, 45% 0, 0 8%)"
        md="polygon(0 62%, 20% 100%, 0 100%)"
      />

      {/* Phones get intro → form → next steps, so the form is never buried. */}
      <div className="container grid gap-10 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-10">
        <div className="lg:col-span-5 lg:row-start-1">
          <Headline as={headingLevel} id="book-title" lines={headline} />
          <p className="mt-6 max-w-md text-lead text-ink-body">{body}</p>
        </div>

        <div className="lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
          <div className="rounded-[2rem] bg-white p-6 shadow-[0_40px_80px_-40px_rgb(11_11_11/0.4)] sm:p-8 md:p-10">
            <BookingForm />
          </div>
        </div>

        <div className="lg:col-span-5 lg:row-start-2">
          <ol className="space-y-5">
            {booking.steps.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-white"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-ink">{step.title}</p>
                  <p className="text-ink-body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="on-dark mt-10 rounded-[2rem] bg-ink p-7 text-white">
            <p className="font-semibold text-white/80">{booking.callPrompt}</p>
            <a
              href={siteConfig.phone.href}
              className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[2.25rem] leading-none text-brand-green transition-colors hover:text-white sm:text-[2.75rem]"
            >
              <Phone className="size-7" aria-hidden="true" strokeWidth={2.5} />
              <span className="sr-only">{booking.callLine} at </span>
              {siteConfig.phone.display}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
