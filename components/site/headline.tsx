import { createElement, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type HeadlineProps = {
  lines: readonly string[];
  as?: "h1" | "h2" | "h3";
  size?: "hero" | "section";
  /** Wrap each line in a mask so it can rise in on page load (hero only). */
  animated?: boolean;
  /** Which line drops to a lighter weight, like PROPERTY SERVICES under EMMETT'S. */
  accentLine?: number;
  className?: string;
  id?: string;
};

/** The heavy Montserrat caps headline: the badge's EMMETT'S wordmark. Each entry in `lines` is its own line. */
export function Headline({ lines, as = "h2", size = "section", animated, accentLine, className, id }: HeadlineProps) {
  return createElement(
    as,
    {
      id,
      className: cn(
        "font-heading font-extrabold uppercase text-forest",
        size === "hero" ? "text-heading-hero" : "text-heading-section",
        className,
      ),
    },
    lines.map((line, i) => {
      // The trailing space keeps the lines apart in the accessible name ("Fall lawn cleanup").
      const inner = <span className={cn(accentLine === i && "font-medium text-pine")}>{line} </span>;
      return animated ? (
        // `block` here too: .hero-line's own styles only exist when motion is allowed.
        <span key={i} className="hero-line block" style={{ "--i": i } as CSSProperties}>
          <span>{inner}</span>
        </span>
      ) : (
        <span key={i} className="block">
          {inner}
        </span>
      );
    }),
  );
}
