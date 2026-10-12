import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Diagonal } from "@/components/site/diagonal";
import { Headline } from "@/components/site/headline";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
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
    <section aria-labelledby="unsub-title" className="relative isolate overflow-hidden bg-gray-light py-16 md:py-28">
      <Diagonal className="bg-gray-mid" sm="polygon(0 0, 100% 0, 100% 5%, 0 12%)" md="polygon(0 0, 40% 0, 24% 100%, 0 100%)" />
      <div className="container">
        <div className="max-w-xl" role="status">
          <Headline as="h1" id="unsub-title" lines={view.headline} />
          <p className="mt-6 text-lead text-ink-body">{view.body}</p>
          {result === "ok" && (
            <p className="mt-4 text-ink-body">
              {copy.changedMind}{" "}
              <a href={siteConfig.phone.href} className="whitespace-nowrap font-semibold text-brand-green-dark underline underline-offset-4">
                {siteConfig.phone.display}
              </a>
            </p>
          )}
          <Button asChild variant="cta-outline" size="cta-sm" className="mt-8">
            <Link href="/">{content.quote.thanks.back}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
