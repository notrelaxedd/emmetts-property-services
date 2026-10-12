import { Benefits } from "@/components/sections/benefits";
import { ContactSection } from "@/components/sections/contact";
import { Hero } from "@/components/sections/hero";
import { Seasons } from "@/components/sections/seasons";
import { Services } from "@/components/sections/services";
import { WhyUs } from "@/components/sections/why-us";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Services />
      <Benefits />
      <WhyUs />
      <Seasons />
      <ContactSection />
    </>
  );
}
