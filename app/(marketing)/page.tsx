import { Benefits } from "@/components/sections/benefits";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { QuoteCta } from "@/components/sections/quote-cta";
import { Seasons } from "@/components/sections/seasons";
import { Services } from "@/components/sections/services";
import { WhyUs } from "@/components/sections/why-us";

/** Every section ends in the same place: the free quote form at /quote. */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Services />
      <Benefits />
      <WhyUs />
      <Seasons />
      <QuoteCta />
    </>
  );
}
