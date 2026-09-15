import { Benefits } from "@/components/sections/benefits";
import { BookingSection } from "@/components/sections/booking";
import { Hero } from "@/components/sections/hero";
import { Reviews } from "@/components/sections/reviews";
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
      <Reviews />
      <BookingSection />
    </>
  );
}
