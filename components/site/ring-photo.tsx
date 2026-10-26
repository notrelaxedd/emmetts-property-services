import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

type RingPhotoProps = {
  src: string;
  alt: string;
  /** next/image `sizes` hint. */
  sizes: string;
  priority?: boolean;
  /** Crop focus, e.g. "40% 30%". */
  position?: string;
  className?: string;
  /** Sits on the bottom of the ring and breaks the line, like the season marks at the foot of the badge. */
  ornament?: ReactNode;
  /** The section's background, so the ornament's patch reads as a gap in the ring. */
  surface?: "cream" | "sage";
  /** Draw the ring in on page load (hero only; skipped with reduced motion). */
  draw?: boolean;
};

/**
 * A photo cropped to a circle inside the badge's thin forest ring, with a band of breathing room
 * between them. Width comes from `className`; it's always square.
 */
export function RingPhoto({
  src,
  alt,
  sizes,
  priority,
  position = "50% 50%",
  className,
  ornament,
  surface = "cream",
  draw,
}: RingPhotoProps) {
  return (
    <div className={cn("relative aspect-square", className)}>
      {/* An SVG ring rather than a border so it can draw itself in. 1.5 units ≈ 1.5px at 320px wide. */}
      <svg
        viewBox="0 0 320 320"
        aria-hidden="true"
        focusable="false"
        className={cn("absolute inset-0 size-full text-forest", draw && "ring-draw")}
      >
        {/* Rotated so the stroke starts (and the draw-in begins) at the bottom, behind the ornament.
            .ring-draw in globals.css relies on this radius: its dash length is the circumference. */}
        <circle cx="160" cy="160" r="159.25" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(90 160 160)" />
      </svg>
      <div
        className={cn("absolute inset-[6.5%] overflow-hidden rounded-full bg-sage [isolation:isolate]", draw && "hero-fade")}
        style={draw ? ({ "--d": "250ms" } as CSSProperties) : undefined}
      >
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" style={{ objectPosition: position }} />
      </div>
      {ornament && (
        <div
          className={cn(
            "absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/2 items-center px-3.5",
            surface === "sage" ? "bg-sage" : "bg-cream",
          )}
        >
          {ornament}
        </div>
      )}
    </div>
  );
}
