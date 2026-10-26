import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Headline } from "./headline";

type EyebrowProps = {
  children: ReactNode;
  as?: "p" | "h2";
  className?: string;
};

/**
 * Small letterspaced caps between two thin rules: the badge's "— PROPERTY SERVICES —" line.
 * Sits above every home page heading. Inherits its color, so it works on forest too.
 */
export function Eyebrow({ children, as: Tag = "p", className }: EyebrowProps) {
  return (
    <Tag
      className={cn(
        "flex items-center justify-center gap-3 font-heading text-xs font-semibold uppercase leading-snug tracking-[0.3em] text-forest sm:gap-4",
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-6 shrink-0 bg-current opacity-40 sm:w-12" />
      {/* The left padding balances the trailing letter-spacing, so the words sit dead center. */}
      <span className="pl-[0.3em] text-center">{children}</span>
      <span aria-hidden="true" className="h-px w-6 shrink-0 bg-current opacity-40 sm:w-12" />
    </Tag>
  );
}

type SectionHeadingProps = {
  id: string;
  eyebrow: ReactNode;
  lines: readonly string[];
  intro?: string;
  /** "dark" for the forest section. */
  tone?: "light" | "dark";
  className?: string;
};

/** Centered eyebrow, heavy caps headline, and an optional intro line. */
export function SectionHeading({ id, eyebrow, lines, intro, tone = "light", className }: SectionHeadingProps) {
  const dark = tone === "dark";
  return (
    <div className={cn("mx-auto max-w-3xl text-center", className)}>
      <Eyebrow className={cn(dark && "text-cream/80")}>{eyebrow}</Eyebrow>
      <Headline id={id} lines={lines} className={cn("mt-6", dark && "text-cream")} />
      {intro && (
        <p className={cn("mx-auto mt-6 max-w-xl text-lead", dark ? "text-cream/80" : "text-forest-body")}>{intro}</p>
      )}
    </div>
  );
}
