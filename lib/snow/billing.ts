/** Snow money and dates. Pure. Every snow customer is billed per push (no monthly plans). */
import type { SnowCustomer, SnowPush, SnowSettings } from "../db/types";

/** The customer's price per push, or the default from snow settings. */
export function pushPrice(c: Pick<SnowCustomer, "per_push_price">, s: Pick<SnowSettings, "default_per_push">): number {
  return Number(c.per_push_price ?? s.default_per_push);
}

/** "$35/push". */
export function planPriceLabel(c: Pick<SnowCustomer, "per_push_price">, s: Pick<SnowSettings, "default_per_push">): string {
  const n = pushPrice(c, s);
  return `${Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`}/push`;
}

/** What this customer owes for the pushes given (one month's worth): each push at the price logged on it. */
export function monthCharge(
  c: Pick<SnowCustomer, "per_push_price">,
  s: Pick<SnowSettings, "default_per_push">,
  pushes: Pick<SnowPush, "price">[],
): { amount: number } {
  const each = pushPrice(c, s);
  return { amount: pushes.reduce((a, p) => a + (p.price === null ? each : Number(p.price)), 0) };
}

/** Local "YYYY-MM-DD" for the first of this month and the start of the winter (Sept 1). */
export function monthStart(localDate: string): string {
  return `${localDate.slice(0, 7)}-01`;
}

export function seasonStart(localDate: string): string {
  const y = Number(localDate.slice(0, 4));
  const m = Number(localDate.slice(5, 7));
  return `${m >= 9 ? y : y - 1}-09-01`;
}
