/** Monthly bill messages for snow and mowing customers: a text and an email the owner sends from their phone. Pure. */
import { siteConfig } from "../site-config";

export type BillMessageInput = {
  customerName: string;
  /** "snow removal" / "lawn mowing" */
  service: string;
  /** "November 2026" */
  monthLabel: string;
  count: number;
  /** "push" / "cut" */
  unit: string;
  amount: number;
  payMethod: "cash" | "card" | "check" | null;
};

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

export function billMessage(b: BillMessageInput): { subject: string; body: string } {
  const first = b.customerName.trim().split(/\s+/)[0] || "there";
  const visits = `${b.count} ${b.unit}${b.count === 1 ? "" : b.unit.endsWith("sh") ? "es" : "s"}`;
  const how =
    b.payMethod === "cash"
      ? "You can pay in cash next time we're by."
      : b.payMethod === "check"
        ? `You can pay by check made out to ${siteConfig.name}.`
        : b.payMethod === "card"
          ? "Reply here and we'll send you a card payment link."
          : "You can pay by cash, check, or card. Just let us know which works.";
  const body =
    `Hi ${first}, here's your ${b.service} bill for ${b.monthLabel}: ${visits}, ${usd(b.amount)} total. ${how} ` +
    `Thank you! ${siteConfig.name}, ${siteConfig.phone.display}`;
  return { subject: `${siteConfig.name}: ${b.service} bill for ${b.monthLabel}`, body };
}

/** Opens Messages with the text filled in (works on iPhone and Android). */
export function smsHref(phone: string, body: string): string {
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
