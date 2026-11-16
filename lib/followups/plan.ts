/**
 * Follow-ups: for one customer, when to message them next, why, and what to say. Pure: no database, no clock.
 *
 * The first rule that matches wins:
 *   1. A job on the calendar (or waiting to be placed)   → nothing to do, they're booked.
 *   2. They asked for a price and haven't got one         → today.
 *   3. You set a "follow up on" date (price log)          → that date.
 *   4. They said no                                       → try again in 90 days.
 *   5. A quote was sent and not answered                  → 2 days after, then every 4 days.
 *   6. You gave a price in conversation, no date set      → 3 days after.
 *   7. Past customer                                      → 21 days after the last job, then every 30 days.
 *   8. Never booked                                       → a week after they came in, then every 30 days.
 */
import { addDays } from "../scheduler/time";
import { PITCHES, suggestSales, type Purchase, type SellIdea } from "./sell";

export const CADENCE = { quoteFirst: 2, quoteAgain: 4, priceGiven: 3, afterJob: 21, keepWarm: 30, neverBooked: 7, saidNo: 90 } as const;

export type FollowUpKind = "needs_quote" | "quote_waiting" | "price_given" | "check_back" | "past_customer" | "never_booked";

/** Lower sorts first: the leads closest to money. */
export const KIND_ORDER: Record<FollowUpKind, number> = { needs_quote: 0, quote_waiting: 1, price_given: 2, check_back: 3, past_customer: 4, never_booked: 5 };

export const KIND_LABEL: Record<FollowUpKind, string> = {
  needs_quote: "Waiting on your price",
  quote_waiting: "Quote not answered",
  price_given: "Price given",
  check_back: "Check back",
  past_customer: "Past customer",
  never_booked: "Never booked",
};

export type FollowUpInput = {
  /** Local "YYYY-MM-DD". */
  today: string;
  businessName: string;
  customer: { id: string; name: string; phone: string | null; email: string | null; createdOn: string };
  onMowing: boolean;
  onSnow: boolean;
  /** Every job that isn't cancelled. `on` is the local day it was done / is scheduled (null = not placed yet). */
  jobs: { status: string; on: string | null; services: string[] }[];
  lastCutOn: string | null;
  lastPushOn: string | null;
  quotes: { id: string; status: string; sentOn: string | null; createdOn: string; total: number; services: string[]; hasJob: boolean }[];
  leads: { id: string; status: string; createdOn: string; hasQuote: boolean }[];
  /** Price-log entries, any order. */
  interactions: { talkedOn: string; createdAt: string; category: string; price: number | null; followUpOn: string | null; status: string }[];
  purchases: Purchase[];
  catalogue?: Map<string, string>;
};

export type FollowUp = {
  customerId: string;
  kind: FollowUpKind;
  /** Local "YYYY-MM-DD" to message them. */
  dueOn: string;
  /** Days past `dueOn` (negative = still ahead). */
  overdue: number;
  reason: string;
  lastJob: { on: string; what: string } | null;
  sell: SellIdea[];
  /** A text / email ready to send. */
  message: string;
  /** Where the owner should go first, when messaging isn't the next step. */
  link: { href: string; label: string } | null;
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const ago = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
const nice = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const max = (...ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort().pop() ?? null;

export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first && !/^(mr|mrs|ms|dr|customer)\.?$/i.test(first) ? first : "there";
}

const UPCOMING = new Set(["unscheduled", "proposed", "crew_confirmed", "booked", "in_progress"]);

export function planFollowUp(input: FollowUpInput): FollowUp | null {
  const { today, customer } = input;
  const hi = `Hi ${firstName(customer.name)}, it's ${input.businessName}.`;

  // 1. Booked: a job still to do.
  if (input.jobs.some((j) => UPCOMING.has(j.status) && (j.on === null || j.on >= today || j.status === "in_progress"))) return null;
  if (input.leads.length && input.leads.every((l) => l.status === "spam") && !input.jobs.length) return null;

  const done = input.jobs.filter((j) => j.status === "done" && j.on).sort((a, b) => (a.on as string).localeCompare(b.on as string));
  const lastDone = done[done.length - 1] ?? null;
  const lastJobOn = max(lastDone?.on, input.lastCutOn, input.lastPushOn);
  const lastJob = lastJobOn
    ? { on: lastJobOn, what: lastJobOn === lastDone?.on ? list(lastDone.services) || "a job" : lastJobOn === input.lastCutOn ? "mowing" : "snow removal" }
    : null;
  const sell = suggestSales({ today, onMowing: input.onMowing, onSnow: input.onSnow, purchases: input.purchases, catalogue: input.catalogue });
  const pitch = sell[0] ? (PITCHES[sell[0].slug]?.line ?? "") : "We have openings in your area over the next couple of weeks.";
  const ask = "Want me to put you on the schedule?";
  const out = (f: Omit<FollowUp, "customerId" | "overdue" | "lastJob">): FollowUp => ({ customerId: customer.id, overdue: daysBetween(f.dueOn, today), lastJob, ...f });

  // 2. Asked for a price, hasn't got one.
  const unpriced = input.quotes.filter((q) => (q.status === "draft" || q.status === "needs_owner") && !q.hasJob).sort((a, b) => a.createdOn.localeCompare(b.createdOn))[0];
  const openLead = input.leads.filter((l) => (l.status === "new" || l.status === "quoting") && !l.hasQuote).sort((a, b) => a.createdOn.localeCompare(b.createdOn))[0];
  if (unpriced || openLead) {
    const since = unpriced?.createdOn ?? (openLead?.createdOn as string);
    return out({
      kind: "needs_quote",
      dueOn: since,
      reason: `Asked for a price ${ago(daysBetween(since, today))} and hasn't got one yet.`,
      sell: [],
      message: `${hi} Thanks for reaching out! I'm putting your price together and will have it to you today.`,
      link: unpriced ? { href: `/admin/quotes/${unpriced.id}`, label: "Price the quote" } : { href: `/admin/leads/${openLead?.id}`, label: "Open the request" },
    });
  }

  const talks = [...input.interactions].sort((a, b) => b.talkedOn.localeCompare(a.talkedOn) || b.createdAt.localeCompare(a.createdAt));
  const last = talks[0] ?? null;
  // A conversation only counts if it's newer than their last job.
  const fresh = last && (!lastJobOn || last.talkedOn >= lastJobOn) ? last : null;
  const sent = input.quotes.filter((q) => q.status === "sent" && !q.hasJob && q.sentOn).sort((a, b) => (b.sentOn as string).localeCompare(a.sentOn as string))[0];

  // 3. The owner picked a date.
  if (fresh && fresh.status === "open" && fresh.followUpOn) {
    const priced = fresh.price !== null;
    return out({
      kind: priced ? "price_given" : "check_back",
      dueOn: fresh.followUpOn,
      reason: priced
        ? `You gave ${usd(fresh.price as number)} for ${fresh.category} on ${nice(fresh.talkedOn)}. Still waiting on them.`
        : `Last messaged ${nice(fresh.talkedOn)} about ${fresh.category}. Time to check back.`,
      sell: sent ? [] : sell,
      message: priced
        ? `${hi} Following up on the ${fresh.category.toLowerCase()} we talked about (${usd(fresh.price as number)}). Still want us to take care of it?`
        : sent
          ? `${hi} Checking in on the quote I sent for ${list(sent.services) || "your property"} (${usd(sent.total)}). Any questions, or should I get you on the schedule?`
          : `${hi} ${pitch} ${ask}`,
      link: null,
    });
  }

  // 4. They said no: rest, then try again with whatever is in season.
  if (fresh && fresh.status === "passed") {
    return out({
      kind: lastJob ? "past_customer" : "never_booked",
      dueOn: addDays(fresh.talkedOn, CADENCE.saidNo),
      reason: `Passed on ${fresh.category} on ${nice(fresh.talkedOn)}. Worth another try with something new.`,
      sell,
      message: `${hi} ${pitch} ${ask}`,
      link: null,
    });
  }

  // 5. Quote sent, no answer.
  if (sent) {
    const sentOn = sent.sentOn as string;
    const nudged = fresh && fresh.talkedOn > sentOn ? fresh.talkedOn : null;
    const what = list(sent.services) || "your property";
    return out({
      kind: "quote_waiting",
      dueOn: nudged ? addDays(nudged, CADENCE.quoteAgain) : addDays(sentOn, CADENCE.quoteFirst),
      reason: `Quote for ${usd(sent.total)} sent ${ago(daysBetween(sentOn, today))}, no answer${nudged ? ` (last nudged ${nice(nudged)})` : ""}.`,
      sell: [],
      message: `${hi} Just checking you got the quote for ${what} (${usd(sent.total)}). Want me to get you on the schedule this week?`,
      link: { href: `/admin/quotes/${sent.id}`, label: "Open the quote" },
    });
  }

  // 6. Price given in conversation, nothing since.
  if (fresh && fresh.status === "open" && fresh.price !== null) {
    return out({
      kind: "price_given",
      dueOn: addDays(fresh.talkedOn, CADENCE.priceGiven),
      reason: `You gave ${usd(fresh.price)} for ${fresh.category} on ${nice(fresh.talkedOn)}. Still waiting on them.`,
      sell,
      message: `${hi} Following up on the ${fresh.category.toLowerCase()} we talked about (${usd(fresh.price)}). Still want us to take care of it?`,
      link: null,
    });
  }

  // 7. Past customer: keep them warm.
  if (lastJob) {
    const touched = fresh && fresh.talkedOn > lastJob.on ? fresh.talkedOn : null;
    const n = daysBetween(lastJob.on, today);
    return out({
      kind: "past_customer",
      dueOn: touched ? addDays(touched, CADENCE.keepWarm) : addDays(lastJob.on, CADENCE.afterJob),
      reason: `Last job ${ago(n)} (${lastJob.what})${touched ? `, last messaged ${nice(touched)}` : ", not messaged since"}.`,
      sell,
      message: `${hi} Thanks again for having us out for ${lastJob.what === "a job" ? "the work" : `the ${lastJob.what.toLowerCase()}`}. ${pitch} ${ask}`,
      link: null,
    });
  }

  // 8. On file, never booked.
  const dead = input.quotes.filter((q) => q.status === "expired" || q.status === "declined").sort((a, b) => b.createdOn.localeCompare(a.createdOn))[0];
  const cameIn = max(customer.createdOn, ...input.leads.map((l) => l.createdOn), ...input.quotes.map((q) => q.sentOn ?? q.createdOn)) as string;
  return out({
    kind: "never_booked",
    dueOn: last ? addDays(last.talkedOn, CADENCE.keepWarm) : addDays(cameIn, CADENCE.neverBooked),
    reason: dead
      ? `Quote for ${usd(dead.total)} ${dead.status === "expired" ? "expired" : "was turned down"} and they never booked${last ? ` (last messaged ${nice(last.talkedOn)})` : ""}.`
      : `On file since ${nice(customer.createdOn)}, never booked a job${last ? ` (last messaged ${nice(last.talkedOn)})` : ""}.`,
    sell,
    message: `${hi} ${pitch} ${ask}`,
    link: null,
  });
}

/** Most urgent first: by kind, then longest overdue. */
export function sortFollowUps<T extends Pick<FollowUp, "kind" | "overdue">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.overdue - a.overdue);
}
