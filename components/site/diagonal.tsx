import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type DiagonalProps = {
  /** clip-path polygon used on phones. */
  sm: string;
  /** clip-path polygon from the md breakpoint up. Falls back to `sm`. */
  md?: string;
  /** Background color class, e.g. "bg-gray-light". */
  className?: string;
  style?: CSSProperties;
};

/**
 * A flat diagonal panel, cut with clip-path (no rotated divs). Stack two or three inside a
 * `relative isolate` section, lightest first, to get the flyer's sliced-gray look.
 */
export function Diagonal({ sm, md, className, style }: DiagonalProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("diag -z-10", className)}
      style={{ "--clip-sm": sm, "--clip-md": md ?? sm, ...style } as CSSProperties}
    />
  );
}
