/** How a customer pays, as the owner records it on the phone. Pure: shared by server and client code. */
import type { PaymentMethod } from "../db/types";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "check", "stripe"];

/** Short label for the schedule / quote pages. `stripe` is the card option: a Stripe pay link emailed after the job. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  stripe: "Card (Stripe link)",
};

/** How we describe it to the customer. */
export const PAYMENT_METHOD_CUSTOMER_LABEL: Record<PaymentMethod, string> = {
  cash: "cash",
  check: "check",
  stripe: "card",
};

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}
