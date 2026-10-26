import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { QuoteCta } from "@/components/sections/quote-cta";
import { Seasons } from "@/components/sections/seasons";
import { Services } from "@/components/sections/services";
import { WhyUs } from "@/components/sections/why-us";

/**
 * Every section ends in the same place: the free quote form at /quote.
 * Cream, cream, sage, cream, sage, then the one forest panel to close.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Services />
      <Seasons />
      <WhyUs />
      <QuoteCta />
    </>
  );
}
