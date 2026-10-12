/**
 * Pricing engine. Pure TypeScript: no I/O, no `server-only`, nothing from `next`, so the web app,
 * the admin console and the fleet workers can all import it.
 *
 *   labor  = crew_size × hours × wage
 *   price  = max(min_job_price, round(labor / (1 − margin)))
 *   fee    = price × card_fee_pct + card_fee_fixed
 *   profit = price − labor − fee
 *
 * The minimum job price applies to the QUOTE total (`priceQuote`), never to a single item
 * (`priceItem`). Prices are whole dollars; fee / profit / labor are rounded to cents.
 */
import type { MinutesRule, QuoteItemStatus, Settings, TreeCover } from "./db/types";

// ---------- Constants ----------

/**
 * ASSUMPTION: when a customer's lot size is unknown (geocoding / parcel lookup missing) we
 * assume a quarter-acre lot, a typical suburban residential lot. The owner can override any
 * number on the approval card.
 */
export const DEFAULT_LOT_ACRES = 0.25;

/** Duration estimates never go below this many minutes. */
export const MIN_MINUTES = 15;
/** Minutes are rounded UP to a multiple of this. */
export const MINUTES_STEP = 5;
/** Hours are rounded UP to a multiple of this. */
export const HOURS_STEP = 0.25;

// ---------- Types ----------

export type PricingSettings = Pick<
  Settings,
  "default_wage" | "margin" | "min_job_price" | "card_fee_pct" | "card_fee_fixed"
>;

export type PriceItemInput = {
  crew_size: number;
  est_hours: number;
  /** Overrides `settings.default_wage`. */
  wage?: number;
  /** Overrides `settings.margin`. */
  margin?: number;
};

export type PricedItem = { labor: number; price: number };

export type QuoteItemInput = {
  crew_size: number;
  est_hours: number;
  price?: number | null;
  is_custom?: boolean;
  status?: QuoteItemStatus;
};

export type QuoteTotals = {
  labor_total: number;
  price_total: number;
  fee_total: number;
  profit_total: number;
  /** One entry per input item, same order. Unpriced / excluded items are `{ labor: 0, price: 0 }`. */
  items: PricedItem[];
  /** True when a custom item still needs the owner's price. */
  needs_owner: boolean;
  /** True when `min_job_price` raised the total. */
  min_applied: boolean;
};

// ---------- Validation helpers ----------

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number (got ${String(value)})`);
  }
}

function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be >= 0 (got ${value})`);
}

function assertMargin(margin: number): void {
  assertFinite("margin", margin);
  if (margin < 0 || margin >= 1) {
    throw new RangeError(`margin must be >= 0 and < 1 (got ${margin})`);
  }
}

/** Strip floating-point noise (e.g. 30.000000000000004) before ceil-ing. */
function clean(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** Round to cents (2 decimals), half away from zero, tolerant of binary float error. */
export function moneyRound(n: number): number {
  assertFinite("amount", n);
  const sign = n < 0 ? -1 : 1;
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : sign * r;
}

// ---------- Time estimates ----------

function rawMinutes(
  rule: MinutesRule,
  lotAcres: number | null,
  treeCover: TreeCover | null,
): number {
  const acres = lotAcres ?? DEFAULT_LOT_ACRES;
  assertNonNegative("lotAcres", acres);
  assertNonNegative("minutes_rule.base", rule.base);
  assertNonNegative("minutes_rule.per_acre", rule.per_acre);
  const level: TreeCover = treeCover ?? "none";
  const mult = rule.tree_cover[level];
  if (mult === undefined) {
    throw new RangeError(`minutes_rule.tree_cover is missing the "${level}" multiplier`);
  }
  assertNonNegative(`minutes_rule.tree_cover.${level}`, mult);
  return (rule.base + rule.per_acre * acres) * mult;
}

/**
 * Estimated on-site minutes: `(base + per_acre × acres) × tree_cover multiplier`, rounded UP to
 * the nearest 5 minutes, minimum 15. Null acres → `DEFAULT_LOT_ACRES`; null tree cover → `none`.
 */
export function estimateMinutes(
  rule: MinutesRule,
  lotAcres: number | null,
  treeCover: TreeCover | null,
): number {
  const raw = clean(rawMinutes(rule, lotAcres, treeCover));
  const rounded = Math.ceil(raw / MINUTES_STEP) * MINUTES_STEP;
  return Math.max(MIN_MINUTES, rounded);
}

/**
 * Same estimate in hours, rounded UP to the nearest 0.25 h (15 min), minimum 0.25 h.
 */
export function estimateHours(
  rule: MinutesRule,
  lotAcres: number | null,
  treeCover: TreeCover | null,
): number {
  const hours = clean(rawMinutes(rule, lotAcres, treeCover) / 60);
  const rounded = Math.ceil(hours / HOURS_STEP) * HOURS_STEP;
  return Math.max(MIN_MINUTES / 60, rounded);
}

// ---------- Item / quote pricing ----------

function laborCost(crewSize: number, hours: number, wage: number): number {
  assertFinite("crew_size", crewSize);
  if (crewSize <= 0) throw new RangeError(`crew_size must be > 0 (got ${crewSize})`);
  assertNonNegative("est_hours", hours);
  assertNonNegative("wage", wage);
  return moneyRound(crewSize * hours * wage);
}

/**
 * Price one line item. The minimum job price is NOT applied here (it applies to the quote total).
 * `price = Math.round(labor / (1 − margin))` in whole dollars.
 */
export function priceItem(input: PriceItemInput, settings: PricingSettings): PricedItem {
  const wage = input.wage ?? settings.default_wage;
  const margin = input.margin ?? settings.margin;
  assertMargin(margin);
  const labor = laborCost(input.crew_size, input.est_hours, wage);
  const price = Math.round(clean(labor / (1 - margin)));
  return { labor, price };
}

/** Card processing fee: `price × card_fee_pct + card_fee_fixed`, in cents. Free when price is 0. */
export function fee(price: number, settings: PricingSettings): number {
  assertNonNegative("price", price);
  if (price === 0) return 0;
  return moneyRound(price * settings.card_fee_pct + settings.card_fee_fixed);
}

/** `price − labor − fee`, in cents. */
export function profit(price: number, labor: number, settings: PricingSettings): number {
  assertNonNegative("price", price);
  assertNonNegative("labor", labor);
  return moneyRound(price - labor - fee(price, settings));
}

/** Items the owner has already resolved without us billing for them. */
function isExcluded(status: QuoteItemStatus | undefined): boolean {
  return status === "declined" || status === "referred";
}

/**
 * Total a quote.
 *
 * - Standard items are priced with `priceItem` (using the wage / margin overrides if given).
 * - Custom items (`is_custom` or status `needs_owner`) with no owner `price` add nothing and set
 *   `needs_owner`. With an owner `price`, that price is used and labor is
 *   `crew_size × est_hours × wage`. Margin overrides never change an owner-entered price.
 * - Items with status `declined` or `referred` (sent to the partner) are not billed and do not
 *   set `needs_owner`.
 * - `price_total = max(min_job_price ?? 0, sum(prices))`; fee and profit are computed on the total.
 */
export function priceQuote(
  items: QuoteItemInput[],
  settings: PricingSettings,
  overrides: { wage?: number; margin?: number } = {},
): QuoteTotals {
  const wage = overrides.wage ?? settings.default_wage;
  const margin = overrides.margin ?? settings.margin;
  assertMargin(margin);
  assertNonNegative("wage", wage);

  let needsOwner = false;
  let laborTotal = 0;
  let priceSum = 0;

  const priced: PricedItem[] = items.map((item) => {
    if (isExcluded(item.status)) return { labor: 0, price: 0 };

    const custom = item.is_custom === true || item.status === "needs_owner";
    if (!custom) {
      const p = priceItem({ crew_size: item.crew_size, est_hours: item.est_hours, wage, margin }, settings);
      laborTotal += p.labor;
      priceSum += p.price;
      return p;
    }

    if (item.price === null || item.price === undefined) {
      needsOwner = true;
      return { labor: 0, price: 0 };
    }
    assertNonNegative("price", item.price);
    const labor = laborCost(item.crew_size, item.est_hours, wage);
    laborTotal += labor;
    priceSum += item.price;
    return { labor, price: item.price };
  });

  const floor = settings.min_job_price ?? 0;
  assertNonNegative("min_job_price", floor);
  const minApplied = floor > priceSum;
  const priceTotal = minApplied ? floor : priceSum;

  const labor_total = moneyRound(laborTotal);
  const price_total = moneyRound(priceTotal);
  const fee_total = fee(price_total, settings);
  const profit_total = moneyRound(price_total - labor_total - fee_total);

  return {
    labor_total,
    price_total,
    fee_total,
    profit_total,
    items: priced,
    needs_owner: needsOwner,
    min_applied: minApplied,
  };
}

// ---------- Explanation ----------

function fmtNum(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function fmtMoney(n: number): string {
  const r = moneyRound(n);
  return Number.isInteger(r) ? `$${r}` : `$${r.toFixed(2)}`;
}

/**
 * One-line human explanation for the approval card, e.g.
 * `2 crew × 1.5 h × $15 = $45 labor; ÷ (1 − 50%) = $90`.
 */
export function explainPrice(input: PriceItemInput, settings: PricingSettings): string {
  const wage = input.wage ?? settings.default_wage;
  const margin = input.margin ?? settings.margin;
  const { labor, price } = priceItem(input, settings);
  const pct = fmtNum(margin * 100);
  return (
    `${fmtNum(input.crew_size)} crew × ${fmtNum(input.est_hours)} h × ${fmtMoney(wage)} = ` +
    `${fmtMoney(labor)} labor; ÷ (1 − ${pct}%) = ${fmtMoney(price)}`
  );
}
