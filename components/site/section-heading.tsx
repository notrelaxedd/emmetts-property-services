import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Headline } from "./headline";

type Align = "center" | "start";

type EyebrowProps = {
  children: ReactNode;
  as?: "p" | "h2";
  /** Centered between two rules, or flush left behind one (for left-aligned sections). */
  align?: Align;
  className?: string;
};

/**
 * Small letterspaced caps between two thin rules: the badge's "— PROPERTY SERVICES —" line.
 * Sits above section and page headings. Forest by default; on a forest panel pass a text color via
 * className (SectionHeading's tone="dark" does). The rules follow the text color.
 */
export function Eyebrow({ children, as: Tag = "p", align = "center", className }: EyebrowProps) {
  const centered = align === "center";
  const rule = cn("h-px w-6 shrink-0 bg-current opacity-40", centered ? "sm:w-12" : "sm:w-10");
  return (
    <Tag
      className={cn(
        "flex items-center gap-3 font-heading text-xs font-semibold uppercase leading-snug tracking-[0.3em] text-forest sm:gap-4",
        centered && "justify-center",
        className,
      )}
    >
      <span aria-hidden="true" className={rule} />
      {/* Centered, the left padding balances the trailing letter-spacing so the words sit dead center. */}
      <span className={cn(centered && "pl-[0.3em] text-center")}>{children}</span>
      {centered && <span aria-hidden="true" className={rule} />}
    </Tag>
  );
}

type SectionHeadingProps = {
  id: string;
  eyebrow: ReactNode;
  lines: readonly string[];
  intro?: string;
  align?: Align;
  /** "dark" for the forest section. */
  tone?: "light" | "dark";
  className?: string;
};

/** Eyebrow, heavy caps headline, and an optional intro line. */
export function SectionHeading({ id, eyebrow, lines, intro, align = "center", tone = "light", className }: SectionHeadingProps) {
  const dark = tone === "dark";
  const centered = align === "center";
  return (
    <div className={cn(centered ? "mx-auto max-w-3xl text-center" : "max-w-2xl", className)}>
      <Eyebrow align={align} className={cn(dark && "text-cream/80")}>
        {eyebrow}
      </Eyebrow>
      <Headline id={id} lines={lines} className={cn("mt-6", dark && "text-cream")} />
      {intro && (
        <p className={cn("mt-6 max-w-xl text-lead", centered && "mx-auto", dark ? "text-cream/80" : "text-forest-body")}>
          {intro}
        </p>
      )}
    </div>
  );
}
