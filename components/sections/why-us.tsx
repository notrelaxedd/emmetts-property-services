import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactLink } from "@/components/site/contact-link";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { OvalPhoto } from "@/components/site/oval-photo";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

export function WhyUs() {
  const { whyUs } = content;

  return (
    <section id="why-us" aria-labelledby="why-us-title" className="relative isolate overflow-hidden bg-gray-light py-20 md:py-28">
      {/* Mirror of the hero: panels come in from the left this time. On phones the photo sits
          last, on panels that slope the opposite way to the section above. */}
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 64%, 100% 76%, 100% 100%, 0 100%)"
        md="polygon(0 0, 46% 0, 32% 100%, 0 100%)"
      />
      <Diagonal
        className="bg-gray-panel"
        sm="polygon(0 84%, 70% 100%, 0 100%)"
        md="polygon(0 0, 22% 0, 0 60%)"
      />

      <div className="container grid items-center gap-14 md:grid-cols-12 md:gap-8">
        <div className="order-last md:order-none md:col-span-5">
          <Reveal from="scale">
            <OvalPhoto
              src={whyUs.image.src}
              alt={whyUs.image.alt}
              position="55% 50%"
              sizes="(min-width: 1280px) 420px, (min-width: 768px) 38vw, 68vw"
              className="mx-auto w-[68%] max-w-[26rem] md:w-full"
            />
          </Reveal>
        </div>

        <div className="md:col-span-7 lg:col-span-6 lg:col-start-7">
          <Headline id="why-us-title" lines={whyUs.headline} accentLine={1} />

          <div className="mt-9 max-w-[38rem] space-y-4 text-lead text-ink-body">
            {whyUs.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>

          <ul className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
            {whyUs.points.map((point, i) => (
              <Reveal as="li" key={point.title} delay={i * 90}>
                <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-brand-green" />
                <h3 className="mt-4 font-display text-[1.375rem] uppercase leading-none text-ink">{point.title}</h3>
                <p className="mt-2 text-[0.975rem] text-ink-body">{point.body}</p>
              </Reveal>
            ))}
          </ul>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild variant="cta" size="cta">
              <a href={siteConfig.phone.href}>
                <Phone aria-hidden="true" />
                {content.cta.call}
              </a>
            </Button>
            <Button asChild variant="cta-outline" size="cta">
              <ContactLink>{content.cta.contact}</ContactLink>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
