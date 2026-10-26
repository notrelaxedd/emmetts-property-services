import type { Season } from "@/lib/services";
import { cn } from "@/lib/utils";

/**
 * The badge's three season marks (maple leaf, grass tuft, snowflake), redrawn as small flat SVGs
 * so they stay crisp at any size. Always decorative: the text around them carries the meaning.
 */

type GlyphProps = { className?: string };

export function MapleLeaf({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" className={className}>
      <path d="M12 1.5 13.6 4.6 15.6 3.6 14.9 8.6 18.4 5.6 19.2 7.6 22.6 7 21.2 10.3 22.8 11.3 18 15 18.8 17.1 12.6 16.2V22.5H11.4V16.2L5.2 17.1 6 15 1.2 11.3 2.8 10.3 1.4 7 4.8 7.6 5.6 5.6 9.1 8.6 8.4 3.6 10.4 4.6Z" />
    </svg>
  );
}

export function GrassTuft({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" className={className}>
      <path d="M11 22.5Q11.1 12.5 12.6 2.5 13.9 12.5 13.3 22.5Z" />
      <path d="M9.7 22.5Q8.6 15 4.6 9.2 9.9 13.6 11.6 22.5Z" />
      <path d="M12.8 22.5Q15 14.4 19.8 7.6 16.6 14.6 14.9 22.5Z" />
      <path d="M8.2 22.5Q6 18.8 1.8 17 6.9 17.6 10 22.5Z" />
      <path d="M14.4 22.5Q17.4 18.4 22.2 16.4 18.4 19 16.4 22.5Z" />
    </svg>
  );
}

export function SnowflakeMark({ className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <path key={deg} d="M12 12V2.2M9 3.8l3 3 3-3" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}

export type SeasonMarkName = "maple" | "grass" | "snow";

const glyphs = { maple: MapleLeaf, grass: GrassTuft, snow: SnowflakeMark } as const;

// Logo-exact colors, for cream and sage. Icons only, never text: they're under 4.5:1 on sage.
const colors = { maple: "text-maple", grass: "text-pine", snow: "text-frost" } as const;

/** Which badge mark stands for each season, and the AA-safe color for small text beside it. */
export const seasonMarks: Record<Season, { mark: SeasonMarkName; text: string }> = {
  "spring-summer": { mark: "grass", text: "text-pine" },
  fall: { mark: "maple", text: "text-maple-ink" },
  winter: { mark: "snow", text: "text-frost-ink" },
};

export function SeasonMark({ mark, className }: { mark: SeasonMarkName; className?: string }) {
  const Glyph = glyphs[mark];
  return <Glyph className={cn("size-5", colors[mark], className)} />;
}

/** Maple, grass, snowflake in a row: the quiet ornament at the foot of the badge. */
export function SeasonTrio({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-4", className)}>
      <SeasonMark mark="maple" />
      <SeasonMark mark="grass" />
      <SeasonMark mark="snow" />
    </span>
  );
}

/** The badge's ground line: a hairline across the page with one grass tuft standing on it. */
export function GroundLine({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("container flex items-end", className)}>
      <span className="h-px flex-1 bg-forest/15" />
      {/* The tuft's blades end 1.5 units above its 24-unit box, so a 1px nudge stands it on the line. */}
      <GrassTuft className="mx-3 size-5 translate-y-px text-pine" />
      <span className="h-px flex-1 bg-forest/15" />
    </div>
  );
}
