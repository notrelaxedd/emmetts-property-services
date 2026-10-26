import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CallLink } from "@/components/site/call-link";
import { Headline } from "@/components/site/headline";
import { Eyebrow } from "@/components/site/section-heading";
import { content } from "@/lib/content";
import { unsubscribeByToken } from "./unsubscribe";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  // Keep the token out of Referer headers sent to third-party scripts.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: { token?: string | string[] } }) {
  const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
  const result = await unsubscribeByToken(token);
  const copy = content.quote.unsubscribe;

  const view =
    result === "ok"
      ? { headline: copy.doneTitle, body: copy.doneBody }
      : result === "not_found"
        ? { headline: copy.invalidTitle, body: copy.invalidBody }
        : { headline: copy.errorTitle, body: copy.errorBody };

  return (
    <section aria-labelledby="unsub-title" className="py-20 md:py-28">
      <div className="container flex flex-col items-center text-center">
        <div className="flex max-w-xl flex-col items-center" role="status">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Headline as="h1" id="unsub-title" lines={view.headline} className="mt-6" />
          <p className="mt-6 text-lead text-forest-body">{view.body}</p>
          {result === "ok" && <CallLink prompt={copy.changedMind} className="mt-4" />}
          <Button asChild variant="cta-outline" size="cta-sm" className="mt-9">
            <Link href="/">{content.quote.thanks.back}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
