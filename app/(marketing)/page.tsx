import { Commercial } from "@/components/sections/commercial";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { QuoteCta } from "@/components/sections/quote-cta";
import { Seasons } from "@/components/sections/seasons";
import { Services } from "@/components/sections/services";
import { WhyUs } from "@/components/sections/why-us";
import { GroundLine } from "@/components/site/season-glyphs";

/**
 * Every section ends in the same place: the free quote form at /quote.
 * Cream, cream (split by the badge's ground line), sage, cream, sage, cream, then the one forest panel to close.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <GroundLine />
      <HowItWorks />
      <Services />
      <Commercial />
      <WhyUs />
      <Seasons />
      <QuoteCta />
    </>
  );
}
