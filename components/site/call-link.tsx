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
      <a
        href={siteConfig.phone.href}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap font-semibold underline decoration-1 underline-offset-[6px] transition-colors",
          dark ? "text-cream decoration-cream/40 hover:decoration-cream" : "text-forest decoration-forest/30 hover:decoration-forest",
        )}
      >
        <Phone className="size-4" aria-hidden="true" strokeWidth={1.75} />
        {siteConfig.phone.display}
      </a>
    </p>
  );
}
