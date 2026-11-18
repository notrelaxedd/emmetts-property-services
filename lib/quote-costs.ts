/**
 * Quick-add cost names for the quote editor: what a line usually costs us out of pocket. Pure, so the
 * editor and tests can share it. Matched by service slug first, then by words in the line's description
 * (so a hand-typed "Aerate + seed" line still gets the right buttons).
 */

type Preset = { slugs: readonly string[]; words: RegExp; costs: readonly string[] };

const PRESETS: readonly Preset[] = [
  { slugs: ["aeration"], words: /aerat/i, costs: ["Aerator rental", "Gas"] },
  { slugs: ["overseeding"], words: /seed/i, costs: ["Grass seed", "Starter fertilizer", "Spreader rental", "Peat moss / straw"] },
  { slugs: ["junk-removal"], words: /junk|haul|dump/i, costs: ["Dump fee", "Truck / trailer rental", "Gas"] },
  { slugs: ["mulching"], words: /mulch/i, costs: ["Mulch"] },
  { slugs: ["pressure-washing"], words: /pressure|power wash/i, costs: ["Pressure washer rental", "Cleaner"] },
];

/** Cost buttons for a line, most specific first, no repeats. Empty when nothing fits (the editor still offers "Other"). */
export function costPresetsFor(slug: string | null | undefined, description: string): string[] {
  const out: string[] = [];
  for (const p of PRESETS) {
    if ((slug && p.slugs.includes(slug)) || p.words.test(description)) {
      for (const c of p.costs) if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** True for an aeration line, where the editor offers to add overseeding alongside. */
export function isAerationLine(slug: string | null | undefined, description: string): boolean {
  return slug === "aeration" || /aerat/i.test(description);
}
