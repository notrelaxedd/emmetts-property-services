import { Phone } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type CallLinkProps = {
  /** Lead-in before the number, e.g. "Rather talk?". */
  prompt?: string;
  /** "dark" on the forest panel. */
  tone?: "light" | "dark";
  className?: string;
};

/** The quiet way to call: a muted lead-in, then the number on a hairline underline. Never louder than the quote button. */
export function CallLink({ prompt, tone = "light", className }: CallLinkProps) {
  const dark = tone === "dark";
  return (
    <p className={cn("text-[0.9375rem]", dark ? "text-cream/75" : "text-forest-muted", className)}>
      {prompt && <>{prompt} </>}
      {/* Inline-block, not inline-flex, so the number keeps the prompt's baseline; the padding makes a 44px target. */}
      <a
        href={siteConfig.phone.href}
        className={cn(
          "inline-block whitespace-nowrap py-2.5 font-semibold underline decoration-1 underline-offset-[6px] transition-colors",
          dark ? "text-cream decoration-cream/40 hover:decoration-cream" : "text-forest decoration-forest/30 hover:decoration-forest",
        )}
      >
        <Phone className="mr-1.5 inline-block size-4 align-[-0.1875rem]" aria-hidden="true" strokeWidth={1.75} />
        {siteConfig.phone.display}
      </a>
    </p>
  );
}
