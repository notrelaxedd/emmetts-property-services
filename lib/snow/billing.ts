/** Snow plan money and dates. Pure. */
import type { SnowCustomer, SnowPlan, SnowPush, SnowSettings } from "../db/types";

export const PLAN_LABEL: Record<SnowPlan, string> = { low: "Low", medium: "Medium", high: "High", per_push: "Per push" };

export function monthlyPrice(plan: SnowPlan, s: Pick<SnowSettings, "low_price" | "medium_price" | "high_price">): number | null {
  if (plan === "low") return Number(s.low_price);
  if (plan === "medium") return Number(s.medium_price);
  if (plan === "high") return Number(s.high_price);
  return null;
}

export function includedPushes(plan: SnowPlan, s: Pick<SnowSettings, "low_pushes" | "medium_pushes" | "high_pushes">): number | null {
  if (plan === "low") return s.low_pushes;
  if (plan === "medium") return s.medium_pushes;
  if (plan === "high") return s.high_pushes;
  return null;
}

/** "$100/mo" or "$35/push". */
export function planPriceLabel(c: Pick<SnowCustomer, "plan" | "per_push_price">, s: SnowSettings): string {
  const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  if (c.plan === "per_push") return `${usd(Number(c.per_push_price ?? s.default_per_push))}/push`;
  return `${usd(monthlyPrice(c.plan, s) ?? 0)}/mo`;
}

/** What this customer owes for the pushes given (one month's worth): the plan price, or the sum of per-push prices. */
export function monthCharge(c: Pick<SnowCustomer, "plan" | "per_push_price">, s: SnowSettings, pushes: Pick<SnowPush, "price">[]): {
  amount: number;
  over: number;
} {
  if (c.plan === "per_push") {
    const each = Number(c.per_push_price ?? s.default_per_push);
    return { amount: pushes.reduce((a, p) => a + (p.price === null ? each : Number(p.price)), 0), over: 0 };
  }
  const included = includedPushes(c.plan, s);
  return { amount: monthlyPrice(c.plan, s) ?? 0, over: included === null ? 0 : Math.max(0, pushes.length - included) };
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
