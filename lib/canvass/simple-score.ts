/**
 * The simple score: three things a crew member can see, 0-3 points each, 9 at most. No probabilities.
 * Pure: no next/* or db imports.
 *
 *   lawn      small 1 / medium 2 / large 3 / xl 3 / unknown 1
 *   customer  adjacent 3 / near (<=150 m) 2 / same street 1 / none 0
 *   owner     occupied 3 / unknown 1 / rental (entity or not occupied) 0
 *
 * The owner's `score_weights` multiply each factor, the weighted total is clamped to 0..9 and rounded.
 * hot >= 7, good 4-6, low <= 3.
 */
import type { ScoreWeights, TierKey } from "./types";

export type NearCustomer = "adjacent" | "near" | "street" | "none";
export type ScoreLabel = "hot" | "good" | "low";

export type SimpleScore = {
  points: number;
  max: 9;
  label: ScoreLabel;
  emoji: "🔥" | "👍" | "➖";
  /** Up to 3, strongest factor first. */
  reasons: string[];
  /** Weighted points per factor (1 decimal); they add up to `points` before clamping and rounding. */
  breakdown: { lawn: number; customer: number; owner: number };
};

export type SimpleScoreInput = {
  tier: TierKey | null;
  turfSqft: number | null;
  nearCustomer: NearCustomer;
  ownerOccupied: boolean | null;
  ownerIsEntity: boolean;
};

export const SCORE_MAX = 9;
export const HOT_MIN = 7;
export const GOOD_MIN = 4;

const LAWN_POINTS: Record<TierKey, number> = { small: 1, medium: 2, large: 3, xl: 3 };
const LAWN_REASON: Record<TierKey, string> = { small: "Small lawn", medium: "Medium lawn", large: "Big lawn", xl: "Big lawn" };
const CUSTOMER_POINTS: Record<NearCustomer, number> = { adjacent: 3, near: 2, street: 1, none: 0 };
const CUSTOMER_REASON: Record<NearCustomer, string | null> = {
  adjacent: "next to a customer",
  near: "near a customer",
  street: "a customer on this street",
  none: null,
};

const weightOf = (w: number | null | undefined): number => (typeof w === "number" && Number.isFinite(w) ? Math.max(0, w) : 1);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function labelFor(points: number): ScoreLabel {
  return points >= HOT_MIN ? "hot" : points >= GOOD_MIN ? "good" : "low";
}

const EMOJI: Record<ScoreLabel, SimpleScore["emoji"]> = { hot: "🔥", good: "👍", low: "➖" };
const LABEL_TEXT: Record<ScoreLabel, string> = { hot: "Hot", good: "Good", low: "Low" };
/** Map colours: hot = brand green, good = amber, low = gray. */
const LABEL_COLOR: Record<ScoreLabel, string> = { hot: "#65C435", good: "#F59E0B", low: "#9A9E9C" };

/** "hot" → "Hot". */
export const scoreLabelText = (label: ScoreLabel): string => LABEL_TEXT[label];
/** Hex for the map: hot "#65C435" (brand green), good "#F59E0B" (amber), low "#9A9E9C" (gray). */
export const scoreColor = (label: ScoreLabel): string => LABEL_COLOR[label];

export function simpleScore(input: SimpleScoreInput, weights: ScoreWeights): SimpleScore {
  const rental = input.ownerIsEntity || input.ownerOccupied === false;
  const raw = {
    lawn: input.tier ? LAWN_POINTS[input.tier] : 1,
    customer: CUSTOMER_POINTS[input.nearCustomer],
    owner: rental ? 0 : input.ownerOccupied === true ? 3 : 1,
  };
  const weighted = {
    lawn: raw.lawn * weightOf(weights?.lawn),
    customer: raw.customer * weightOf(weights?.customer),
    owner: raw.owner * weightOf(weights?.owner),
  };
  const total = weighted.lawn + weighted.customer + weighted.owner;
  const points = Math.round(Math.min(SCORE_MAX, Math.max(0, total)));
  const label = labelFor(points);

  // Reasons: strongest weighted factors first; ties keep the order lawn, customer, owner.
  const candidates: { text: string; value: number }[] = [];
  candidates.push({ text: input.tier ? LAWN_REASON[input.tier] : "", value: weighted.lawn });
  candidates.push({ text: CUSTOMER_REASON[input.nearCustomer] ?? "", value: weighted.customer });
  candidates.push({ text: input.ownerOccupied === true && !rental ? "owner-occupied" : "", value: weighted.owner });
  // A rental scores 0 but is worth saying: it changes the pitch. Ranks after every point-earning factor.
  if (rental) candidates.push({ text: "Rental (landlord pitch)", value: 0 });
  const reasons = candidates
    .map((c, order) => ({ ...c, order }))
    .filter((c) => c.text && (c.value > 0 || c.text.startsWith("Rental")))
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .slice(0, 3)
    .map((c) => c.text);

  return {
    points,
    max: SCORE_MAX,
    label,
    emoji: EMOJI[label],
    reasons,
    breakdown: { lawn: round1(weighted.lawn), customer: round1(weighted.customer), owner: round1(weighted.owner) },
  };
}

/** "Big lawn · next to a customer · owner-occupied" (reasons joined with " · "; first letter capitalised). */
export function reasonText(score: Pick<SimpleScore, "reasons">): string {
  const text = score.reasons.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
