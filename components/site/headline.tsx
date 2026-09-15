import { createElement, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type HeadlineProps = {
  lines: readonly string[];
  as?: "h1" | "h2" | "h3";
  size?: "hero" | "section";
  /** Wrap each line in a mask so it can rise in on page load (hero only). */
  animated?: boolean;
  /** Which line gets the green underline accent. */
  accentLine?: number;
  className?: string;
  id?: string;
};

/** The big condensed-caps headline. Each entry in `lines` is its own line. */
export function Headline({ lines, as = "h2", size = "section", animated, accentLine, className, id }: HeadlineProps) {
  return createElement(
    as,
    { id, className: cn("display", size === "hero" ? "text-hero" : "text-section", className) },
    lines.map((line, i) => {
      const accent = accentLine === i;
      const inner = (
        <span
          className={cn(
            accent &&
              "underline decoration-brand-green decoration-[0.09em] underline-offset-[0.1em] [text-decoration-skip-ink:none]",
          )}
        >
          {line}
        </span>
      );
      return animated ? (
        <span key={i} className="hero-line" style={{ "--i": i } as CSSProperties}>
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
