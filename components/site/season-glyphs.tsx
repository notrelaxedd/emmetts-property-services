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

// Logo-exact colors on cream/sage (icons only, never text); the *-light set is for forest panels.
const tones = {
  logo: { maple: "text-maple", grass: "text-pine", snow: "text-frost" },
  light: { maple: "text-maple-light", grass: "text-grass-light", snow: "text-frost-light" },
} as const;

type Tone = keyof typeof tones;

export function SeasonMark({ mark, tone = "logo", className }: { mark: SeasonMarkName; tone?: Tone; className?: string }) {
  const Glyph = glyphs[mark];
  return <Glyph className={cn("size-5", tones[tone][mark], className)} />;
}

/** Maple, grass, snowflake in a row: the quiet ornament at the foot of the badge. */
export function SeasonTrio({ tone = "logo", className }: { tone?: Tone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-4", className)}>
      <SeasonMark mark="maple" tone={tone} />
      <SeasonMark mark="grass" tone={tone} />
      <SeasonMark mark="snow" tone={tone} />
    </span>
  );
}

/** A hairline across the page with the trio resting on it, like the badge's ground line. */
export function SeasonDivider({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center gap-6", className)}>
      <span className="h-px flex-1 bg-forest/15" />
      <SeasonTrio />
      <span className="h-px flex-1 bg-forest/15" />
    </div>
  );
}
