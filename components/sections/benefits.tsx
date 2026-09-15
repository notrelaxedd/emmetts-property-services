import { ArrowRight } from "lucide-react";
import { BookLink } from "@/components/site/book-link";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { OvalPhoto } from "@/components/site/oval-photo";
import { PillList } from "@/components/site/pill-list";
import { Reveal } from "@/components/site/reveal";
import { content } from "@/lib/content";

export function Benefits() {
  const { benefits } = content;

  return (
    <section aria-labelledby="benefits-title" className="relative isolate overflow-hidden py-20 md:py-28">
      <Diagonal
        className="bg-gray-mid"
        sm="polygon(0 66%, 100% 54%, 100% 100%, 0 100%)"
        md="polygon(62% 0, 78% 0, 60% 100%, 44% 100%)"
      />
      <Diagonal
        className="bg-gray-panel"
        sm="polygon(0 82%, 100% 70%, 100% 100%, 0 100%)"
        md="polygon(78% 0, 100% 0, 100% 100%, 60% 100%)"
      />

      <div className="container grid items-center gap-14 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-7 lg:col-span-6">
          <Headline id="benefits-title" lines={benefits.headline} />
          <p className="mt-6 max-w-lg text-lead text-ink-body">{benefits.body}</p>
          <BookLink
            service={content.services.featuredSlug}
            className="mt-5 inline-flex items-center gap-2 font-semibold text-ink underline decoration-brand-green decoration-2 underline-offset-[6px] transition-colors hover:text-brand-green-dark">
            Book your cleanup
            <ArrowRight className="size-4" aria-hidden="true" />
          </BookLink>
          <div className="mt-10">
            <PillList items={benefits.pills} />
          </div>
        </div>

        <div className="md:col-span-5 lg:col-span-5 lg:col-start-8">
          <Reveal from="scale">
            <OvalPhoto
              src={benefits.image.src}
              alt={benefits.image.alt}
              sizes="(min-width: 1280px) 400px, (min-width: 768px) 36vw, 68vw"
              className="mx-auto w-[68%] max-w-[25rem] md:w-full"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
