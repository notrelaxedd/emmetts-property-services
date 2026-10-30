/**
 * Knocker and pitch stats for the Canvass stats page: how often doors open and how often a conversation closes.
 * Pure (no next/* or db imports); the page feeds it the knock rows plus id → name maps.
 *
 * answer  = any outcome but "no_answer" (someone came to the door)
 * quote   = "quote_given"
 * close   = "booked"
 * answerRate = answers ÷ knocks; closeRate = closes ÷ answers (closes per conversation, the door-to-door norm).
 */
import type { Knock } from "../db/types";
import { percent } from "../flyers/stats";

export { percent };

export type KnockStatInput = Pick<Knock, "knocker_id" | "pitch_id" | "outcome">;

export type KnockStatRow = {
  /** profiles.id / pitches.id; null for knocks logged without a pitch. */
  id: string | null;
  name: string;
  /** Sample size (n). */
  knocks: number;
  answers: number;
  /** answers ÷ knocks; null without knocks. */
  answerRate: number | null;
  quotes: number;
  closes: number;
  /** closes ÷ answers; null until a door has opened. */
  closeRate: number | null;
};

export type KnockStats = { byKnocker: KnockStatRow[]; byPitch: KnockStatRow[] };

export type StatNames = { knockers: ReadonlyMap<string, string>; pitches: ReadonlyMap<string, string> };

export const NO_PITCH_NAME = "No pitch";

export const isAnswer = (outcome: Knock["outcome"]): boolean => outcome !== "no_answer";
export const isQuote = (outcome: Knock["outcome"]): boolean => outcome === "quote_given";
export const isClose = (outcome: Knock["outcome"]): boolean => outcome === "booked";

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

type Counts = { knocks: number; answers: number; quotes: number; closes: number };

function tally(knocks: readonly KnockStatInput[], keyOf: (k: KnockStatInput) => string | null): Map<string | null, Counts> {
  const acc = new Map<string | null, Counts>();
  for (const k of knocks) {
    const key = keyOf(k);
    let c = acc.get(key);
    if (!c) acc.set(key, (c = { knocks: 0, answers: 0, quotes: 0, closes: 0 }));
    c.knocks++;
    if (isAnswer(k.outcome)) c.answers++;
    if (isQuote(k.outcome)) c.quotes++;
    if (isClose(k.outcome)) c.closes++;
  }
  return acc;
}

function rows(acc: Map<string | null, Counts>, nameOf: (id: string | null) => string): KnockStatRow[] {
  const out: KnockStatRow[] = [];
  acc.forEach((c, id) =>
    out.push({
      id,
      name: nameOf(id),
      knocks: c.knocks,
      answers: c.answers,
      answerRate: ratio(c.answers, c.knocks),
      quotes: c.quotes,
      closes: c.closes,
      closeRate: ratio(c.closes, c.answers),
    }),
  );
  return out.sort((a, b) => b.knocks - a.knocks || a.name.localeCompare(b.name));
}

/** A short stand-in when a profile / pitch has been deleted. */
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

/** Rows per knocker and per pitch, most knocks first. */
export function knockStats(knocks: readonly KnockStatInput[], names: StatNames): KnockStats {
  const byKnocker = rows(
    tally(knocks, (k) => k.knocker_id),
    (id) => (id === null ? "Unknown" : names.knockers.get(id) ?? shortId(id)),
  );
  const byPitch = rows(
    tally(knocks, (k) => k.pitch_id ?? null),
    (id) => (id === null ? NO_PITCH_NAME : names.pitches.get(id) ?? shortId(id)),
  );
  return { byKnocker, byPitch };
}

/** All rows together (for a totals line). */
export function totalKnockStats(stats: readonly KnockStatRow[]): Omit<KnockStatRow, "id" | "name"> {
  const t = { knocks: 0, answers: 0, quotes: 0, closes: 0 };
  for (const r of stats) {
    t.knocks += r.knocks;
    t.answers += r.answers;
    t.quotes += r.quotes;
    t.closes += r.closes;
  }
  return { ...t, answerRate: ratio(t.answers, t.knocks), closeRate: ratio(t.closes, t.answers) };
}
