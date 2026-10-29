/**
 * Booking, owner-driven:
 *
 *   quote estimated → job on the "Needs a day" rail
 *     → owner drags it onto the calendar          `scheduleJobAt`   (crew polled by email, call card raised)
 *     → crew answer Available / Can't             `recordCrewResponse` (enough yeses → `crew_confirmed`)
 *     → owner calls the customer, confirms the quote and the day, hears cash / check / card
 *     → owner books it                             `bookJob`         (crew picked, quote accepted, customer emailed)
 *     → job done → payment collected               lib/ops/payments.ts / lib/stripe/webhook.ts
 *
 * "Call <customer> to confirm" is one `booking` approval per job (`payload.call_to_confirm`), raised
 * when the job is placed and refreshed as crew answer; approving it with `payment_method` + `crew_ids`
 * is the same as booking from the schedule. Plain Node (relative imports): fleet workers import this too.
 */
import { draftMessage } from "../ai/claude";
import type { Approval, AssignmentStatus, Customer, Job, JobAssignment, Message, PaymentMethod, Quote } from "../db/types";
import { sendMessage } from "../email";
import { fee, moneyRound } from "../pricing";
import { HOLDING_ASSIGNMENT_STATUSES } from "../scheduler/capacity";
import { formatDayLabel, formatDuration, formatTimeRange } from "../scheduler/time";
import { siteConfig } from "../site-config";
import { appendNote } from "../stripe/checkout";
import { createApproval, decideApproval } from "./approvals";
import { notifyOffers, pollCrewForJob } from "./crew-offers";
import { isCallToConfirmPayload, requestResolve, servicesForJob, tryTransitionJob } from "./jobs";
import { PAYMENT_METHOD_CUSTOMER_LABEL, PAYMENT_METHOD_LABEL } from "./payment-methods";
import { getSettings } from "./settings";
import { enqueueTask } from "./tasks";
import { check, one } from "./types";
import type { Db } from "./types";

const DAY_MS = 86_400_000;
const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

// ---------- Labels ----------

/** "Tue Oct 14, 9:00–10:30am" (business timezone), or null if unscheduled. */
export function describeSlot(job: Pick<Job, "start_at" | "end_at">): string | null {
  if (!job.start_at) return null;
  const start = new Date(job.start_at);
  const end = job.end_at ? new Date(job.end_at) : start;
  return `${formatDayLabel(start)}, ${formatTimeRange(start, end)}`;
}

async function loadJob(db: Db, jobId: string): Promise<Job> {
  const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "booking(job)");
  if (!job) throw new Error(`job ${jobId} not found`);
  return job;
}

async function loadCustomer(db: Db, id: string): Promise<Customer | null> {
  return check(await db.from("customers").select("*").eq("id", id).maybeSingle(), "booking(customer)");
}

async function loadQuote(db: Db, id: string | null): Promise<Quote | null> {
  if (!id) return null;
  return check(await db.from("quotes").select("*").eq("id", id).maybeSingle(), "booking(quote)");
}

// ---------- The "call to confirm" card ----------

/** Crew answers on a job, for card summaries and the schedule. */
export function crewTally(rows: Pick<JobAssignment, "status">[]): { available: number; asked: number; cant: number } {
  return {
    available: rows.filter((a) => a.status === "accepted").length,
    asked: rows.filter((a) => a.status === "offered" || a.status === "accepted").length,
    cant: rows.filter((a) => a.status === "declined").length,
  };
}

/**
 * Raise (or refresh) the one "Call <customer> to confirm" card for a job on the calendar. The owner
 * approves it with the payment method and the crew once the customer says yes on the phone.
 */
export async function raiseCallToConfirm(db: Db, jobId: string, opts: { actor: string; reconfirm?: boolean }): Promise<Approval> {
  const job = await loadJob(db, jobId);
  const [customer, quote, rows] = await Promise.all([
    loadCustomer(db, job.customer_id),
    loadQuote(db, job.quote_id),
    db.from("job_assignments").select("*").eq("job_id", jobId),
  ]);
  const tally = crewTally(check(rows, "callCard(assignments)") ?? []);
  const name = customer?.name ?? "the customer";
  const slot = describeSlot(job) ?? "a day";
  const parts = [
    quote ? `${money(quote.price_total)}, collected after the job` : null,
    `${job.crew_size} crew, ${formatDuration(job.est_minutes)}`,
    tally.asked ? `${tally.available} of ${tally.asked} crew asked said they're free` : "no crew asked yet",
    customer?.phone ? null : "no phone number on file",
  ].filter((p): p is string => !!p);
  return createApproval(db, {
    kind: "booking",
    ref_table: "jobs",
    ref_id: jobId,
    payload: {
      job_id: jobId,
      call_to_confirm: true,
      reconfirm: opts.reconfirm === true,
      quote_id: job.quote_id,
      price_total: quote?.price_total ?? null,
      phone: customer?.phone ?? null,
    },
    title: `${opts.reconfirm ? "Re-confirm with" : "Call"} ${name}: ${slot}`,
    summary: parts.join(" · "),
    created_by: opts.actor,
  });
}

/** Close the pending call card(s) for a job without booking it. */
export async function withdrawCallToConfirm(db: Db, jobId: string, decision: "approved" | "rejected", opts: { actor: string; note: string }): Promise<number> {
  const pending =
    check(
      await db.from("approvals").select("*").eq("kind", "booking").eq("ref_table", "jobs").eq("ref_id", jobId).eq("status", "pending"),
      "withdrawCallToConfirm",
    ) ?? [];
  let n = 0;
  for (const a of pending) {
    if (!isCallToConfirmPayload(a.payload)) continue;
    try {
      await decideApproval(db, a.id, decision, { decidedBy: opts.actor, note: opts.note });
      n++;
    } catch (e) {
      console.warn(`[booking] could not close call card ${a.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** Drop a not-yet-run day-before reminder; booking re-enqueues it at the right time. */
export async function clearQueuedReminder(db: Db, jobId: string): Promise<void> {
  check(await db.from("fleet_tasks").delete().eq("dedupe_key", `reminder:${jobId}`).eq("status", "queued"), "clear reminder");
}

// ---------- Putting a job on the calendar ----------

export type ScheduleJobResult = { job: Job; asked: number; emailed: number; reconfirm: boolean; skipped: { name: string; why: string }[] };

/**
 * Put a job on the calendar at [start, end) (the owner dragged it, or the scheduler proposed it and
 * the owner moved it): the slot is set, the job is `proposed`, every crew member who could work it is
 * (re-)asked by email, and the "Call <customer> to confirm" card is raised or refreshed. A job the
 * customer had already confirmed (`booked`) goes back to `proposed`: the new day needs re-confirming.
 * Owner-hours and midnight checks are the caller's (app/admin/schedule/conflicts.ts).
 */
export async function scheduleJobAt(
  db: Db,
  jobId: string,
  start: Date,
  end: Date,
  opts: { actor: string; siteUrl: string },
): Promise<ScheduleJobResult> {
  if (!(end > start)) throw new Error("scheduleJobAt: the slot has no length");
  const job = await loadJob(db, jobId);
  if (["in_progress", "done", "cancelled"].includes(job.status)) {
    throw new Error(`A ${job.status.replace("_", " ")} job can't be moved.`);
  }
  const slot = { start_at: start.toISOString(), end_at: end.toISOString() };
  const reconfirm = job.status === "booked";
  let placed: Job | null;
  if (job.status === "proposed") {
    const rows = check(
      await db
        .from("jobs")
        .update({ ...slot, owner_hold: false, weather_hold: false, weather_hold_date: null, resolve_reason: null })
        .eq("id", jobId)
        .eq("status", "proposed")
        .select("*"),
      "scheduleJobAt(move)",
    );
    placed = rows?.[0] ?? null;
  } else {
    placed = await tryTransitionJob(db, jobId, "proposed", {
      actor: opts.actor,
      from: job.status,
      patch: {
        ...slot,
        schedule_reason: job.status === "unscheduled" ? `Placed by ${opts.actor}` : `Moved by ${opts.actor}`,
        owner_hold: false,
        weather_hold: false,
        weather_hold_date: null,
        resolve_reason: null,
      },
    });
  }
  if (!placed) throw new Error("The job changed while you were moving it. Refresh and try again.");

  const poll = await pollCrewForJob(db, placed, { siteUrl: opts.siteUrl, reset: true });
  await clearQueuedReminder(db, jobId);
  await raiseCallToConfirm(db, jobId, { actor: opts.actor, reconfirm });
  return { job: placed, asked: poll.asked.length, emailed: poll.emailed, reconfirm, skipped: poll.skipped.map((s) => ({ name: s.name, why: s.why })) };
}

/**
 * Take a job back off the calendar onto the rail (the customer wants another day, or you changed your
 * mind): crew offers are withdrawn, the call card closed, and the job held so the scheduler doesn't
 * put it straight back. The quote keeps whatever the customer agreed to.
 */
export async function unplaceJob(db: Db, jobId: string, opts: { actor: string; note?: string }): Promise<Job> {
  const job = await loadJob(db, jobId);
  const moved = await tryTransitionJob(db, jobId, "unscheduled", {
    actor: opts.actor,
    from: ["proposed", "crew_confirmed", "booked"],
    patch: { owner_hold: true, resolve_reason: null, weather_hold: false, weather_hold_date: null, schedule_reason: opts.note ?? `Taken off the calendar by ${opts.actor}` },
  });
  if (!moved) throw new Error(`A ${job.status.replace("_", " ")} job can't be taken off the calendar.`);
  check(await db.from("job_assignments").delete().eq("job_id", jobId), "unplaceJob(offers)");
  await clearQueuedReminder(db, jobId);
  await withdrawCallToConfirm(db, jobId, "rejected", { actor: opts.actor, note: opts.note ?? "Taken off the calendar." });
  return moved;
}

// ---------- Crew answers ----------

export type CrewResponse = "accepted" | "declined";
export type CrewResponseResult = { changed: boolean; confirmed: boolean; status: AssignmentStatus; jobStatus: Job["status"] };

/**
 * A crew member's answer to an availability offer (crew app or email link). Available / Can't can be
 * changed back and forth while the job is still waiting on the customer; once the job is booked the
 * answer is final here (dropping a booked job is the crew app's Drop / Swap, which keeps the notice
 * window). Enough yeses move the job to `crew_confirmed` (`maybeConfirmJob`); a "can't" on a job that
 * is short-handed asks the scheduler to look for cover for the same slot.
 */
export async function recordCrewResponse(
  db: Db,
  assignment: JobAssignment,
  response: CrewResponse,
  opts: { siteUrl: string; actor: string },
): Promise<CrewResponseResult> {
  const job = await loadJob(db, assignment.job_id);
  const now = new Date().toISOString();
  const open = job.status === "proposed" || job.status === "crew_confirmed";
  const may =
    assignment.status === "offered" ||
    (open && (assignment.status === "accepted" || assignment.status === "declined") && assignment.status !== response);
  if (!may) return { changed: false, confirmed: false, status: assignment.status, jobStatus: job.status };

  const rows = check(
    await db
      .from("job_assignments")
      .update({ status: response, responded_at: now })
      .eq("id", assignment.id)
      .eq("status", assignment.status)
      .select("id"),
    "recordCrewResponse(update)",
  );
  if (!rows?.length) return { changed: false, confirmed: false, status: assignment.status, jobStatus: job.status };

  if (response === "accepted") {
    const confirmed = await maybeConfirmJob(db, job.id, opts);
    return { changed: true, confirmed, status: "accepted", jobStatus: confirmed ? "crew_confirmed" : job.status };
  }

  // A no. If the job had enough yeses and now hasn't, it is waiting on crew again (same slot).
  let jobStatus = job.status;
  if (job.status === "crew_confirmed") {
    const live = (check(await db.from("job_assignments").select("*").eq("job_id", job.id), "recordCrewResponse(rows)") ?? []).filter(
      (a) => a.status === "accepted",
    );
    if (live.length < job.crew_size) {
      const back = await tryTransitionJob(db, job.id, "proposed", { actor: opts.actor, from: "crew_confirmed" });
      if (back) jobStatus = "proposed";
    }
  }
  if (jobStatus === "proposed" || jobStatus === "booked") {
    await requestResolve(db, [job.id], "declined", "offer_declined");
  }
  await raiseCallToConfirm(db, job.id, { actor: opts.actor }).catch(() => undefined);
  return { changed: true, confirmed: false, status: "declined", jobStatus };
}

/**
 * If at least `crew_size` crew members said they're available for a `proposed` job, move it to
 * `crew_confirmed` and refresh the call card so the owner knows the crew is there. Rows still waiting
 * for an answer don't block it (the owner picks the crew when booking); `swap_offered` rows are
 * candidates, not crew. Returns true when this call confirmed it.
 */
export async function maybeConfirmJob(db: Db, jobId: string, opts: { siteUrl: string; actor: string }): Promise<boolean> {
  const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "maybeConfirmJob(job)");
  if (!job || job.status !== "proposed") return false;
  const rows = check(await db.from("job_assignments").select("*").eq("job_id", jobId), "maybeConfirmJob(assignments)") ?? [];
  const accepted = rows.filter((a) => a.status === "accepted").length;
  if (accepted === 0 || accepted < job.crew_size) return false;
  const confirmed = await tryTransitionJob(db, jobId, "crew_confirmed", { actor: opts.actor, from: "proposed" });
  if (!confirmed) return false;
  await raiseCallToConfirm(db, jobId, { actor: opts.actor });
  return true;
}

// ---------- Booking (the customer said yes on the phone) ----------

export type BookJobInput = {
  /** How the customer said they'll pay once the job is done. */
  paymentMethod: PaymentMethod;
  /** Crew to put on the job (from the offers that are `offered` / `accepted`). Empty = the owner alone. */
  crewIds: string[];
  actor: string;
  siteUrl: string;
  note?: string | null;
};

export type BookJobResult = { job: Job; quote: Quote | null; confirmationSent: boolean };

/** Statuses a quote can be confirmed from. `declined`: the customer changed their mind on the phone. */
const CONFIRMABLE: Quote["status"][] = ["draft", "needs_owner", "sent", "accepted", "expired", "declined"];

/**
 * The owner confirmed the quote and the day with the customer by phone:
 *  - the chosen crew's offers become `accepted`, every other offer on the job is withdrawn;
 *  - the job is `booked` (crew_size follows the crew actually put on it);
 *  - the quote is `accepted` with the payment method the customer named (collected after the job, so
 *    `paid_at` stays null); cash / check carry no card fee; the lead is won;
 *  - the call card is closed, the customer gets the confirmation email and the day-before reminder is queued.
 */
export async function bookJob(db: Db, jobId: string, input: BookJobInput): Promise<BookJobResult> {
  const job = await loadJob(db, jobId);
  if (job.status === "booked") throw new Error("This job is already confirmed. Move it on the schedule if the day changed.");
  if (job.status !== "proposed" && job.status !== "crew_confirmed") {
    throw new Error(
      job.status === "unscheduled" ? "Put the job on the calendar first, then confirm it." : `A ${job.status.replace("_", " ")} job can't be booked.`,
    );
  }
  if (!job.start_at) throw new Error("Put the job on the calendar first, then confirm it.");

  const quote = await loadQuote(db, job.quote_id);
  if (quote) {
    if (!CONFIRMABLE.includes(quote.status)) throw new Error(`This quote is ${quote.status}.`);
    const items = check(await db.from("quote_items").select("*").eq("quote_id", quote.id), "bookJob(items)") ?? [];
    if (items.some((i) => i.status === "needs_owner")) {
      throw new Error("A line on the quote still needs your price. Price, refer or decline it on the quote page first.");
    }
  }

  const rows = check(await db.from("job_assignments").select("*").eq("job_id", jobId), "bookJob(assignments)") ?? [];
  const wanted = Array.from(new Set(input.crewIds));
  const chosen: JobAssignment[] = [];
  for (const id of wanted) {
    const row = rows.find((a) => a.crew_id === id && (a.status === "offered" || a.status === "accepted"));
    if (!row) {
      const names = check(await db.from("profiles").select("*").eq("id", id).maybeSingle(), "bookJob(profile)");
      throw new Error(`${names?.name ?? "That crew member"} isn't on the offer list for this job any more. Refresh and pick again.`);
    }
    chosen.push(row);
  }

  const now = new Date().toISOString();
  const keep = new Set(chosen.map((c) => c.id));
  for (const row of rows) {
    if (keep.has(row.id)) {
      if (row.status !== "accepted") {
        check(await db.from("job_assignments").update({ status: "accepted", responded_at: row.responded_at ?? now }).eq("id", row.id), "bookJob(accept)");
      }
    } else {
      check(await db.from("job_assignments").delete().eq("id", row.id), "bookJob(withdraw)");
    }
  }

  const booked = await tryTransitionJob(db, jobId, "booked", {
    actor: input.actor,
    from: ["proposed", "crew_confirmed"],
    patch: { crew_size: Math.max(1, chosen.length), resolve_reason: null, owner_hold: false },
  });
  if (!booked) throw new Error("The job changed while you were booking it. Refresh and try again.");

  let confirmedQuote: Quote | null = null;
  if (quote) {
    const settings = await getSettings(db);
    const feeTotal = input.paymentMethod === "stripe" ? fee(quote.price_total, settings) : 0;
    const how = PAYMENT_METHOD_LABEL[input.paymentMethod];
    const note = `Confirmed by phone (${input.actor}): ${describeSlot(booked)}, pays by ${how.toLowerCase()} after the job.${input.note?.trim() ? ` ${input.note.trim()}` : ""}`;
    confirmedQuote = one(
      await db
        .from("quotes")
        .update({
          status: "accepted",
          accepted_at: quote.accepted_at ?? now,
          payment_method: quote.paid_at ? quote.payment_method : input.paymentMethod,
          fee_total: quote.paid_at ? quote.fee_total : feeTotal,
          profit_total: quote.paid_at ? quote.profit_total : moneyRound(quote.price_total - quote.labor_total - feeTotal),
          rationale: appendNote(quote.rationale, note),
        })
        .eq("id", quote.id)
        .select("*")
        .single(),
      "bookJob(quote)",
    );
    check(await db.from("leads").update({ status: "won" }).eq("id", quote.lead_id), "bookJob(lead)");
  }

  await withdrawCallToConfirm(db, jobId, "approved", { actor: input.actor, note: `Booked: pays by ${PAYMENT_METHOD_LABEL[input.paymentMethod].toLowerCase()} after the job.` });
  const confirmationSent = await completeBooking(db, booked, { actor: input.actor, siteUrl: input.siteUrl });
  return { job: booked, quote: confirmedQuote, confirmationSent };
}

// ---------- Customer confirmation + reminder ----------

/** Plain-text confirmation used when the AI draft fails or the AI budget cap is hit. */
export function fallbackConfirmationEmail(input: {
  firstName: string;
  services: string[];
  when: string | null;
  address: string | null;
  /** How they said they'd pay; adds the "nothing to pay now" line. */
  paymentMethod?: PaymentMethod | null;
}): { subject: string; body: string } {
  const what = input.services.length ? input.services.join(", ") : "your service";
  const pay = input.paymentMethod
    ? `Nothing to pay now: as agreed, we'll collect payment by ${PAYMENT_METHOD_CUSTOMER_LABEL[input.paymentMethod]} once the job is done${input.paymentMethod === "stripe" ? " (we'll email you a secure card link)" : ""}.`
    : null;
  const body = [
    `Hi ${input.firstName},`,
    "",
    input.when
      ? `You're booked! Our crew will be there for ${what} on ${input.when}${input.address ? ` at ${input.address}` : ""}.`
      : `You're booked for ${what}${input.address ? ` at ${input.address}` : ""}. We'll confirm the exact day and time with you.`,
    "",
    ...(pay ? [pay, ""] : []),
    "We'll send a reminder the day before. If the weather turns, we'll reach out to reschedule.",
    "",
    `Questions or need to change something? Call or text us at ${siteConfig.phone.display}.`,
    "",
    "Thanks,",
    siteConfig.name,
  ].join("\n");
  return { subject: input.when ? `You're booked: ${input.when}` : "You're booked", body };
}

async function draftConfirmation(db: Db, customer: Customer, services: string[], job: Job, paymentMethod: PaymentMethod | null): Promise<{ subject: string; body: string }> {
  const firstName = customer.name.trim().split(/\s+/)[0] || customer.name;
  const when = describeSlot(job);
  const fallback = fallbackConfirmationEmail({ firstName, services, when, address: customer.address, paymentMethod });
  try {
    const draft = await draftMessage(db, {
      kind: "confirmation",
      customer: { name: customer.name, first_name: firstName },
      job: { services, start_at: when ?? undefined, address: customer.address ?? undefined },
      extra: paymentMethod
        ? { payment: `Nothing to pay now. Payment by ${PAYMENT_METHOD_CUSTOMER_LABEL[paymentMethod]} is collected after the job is done${paymentMethod === "stripe" ? " (a secure card link is emailed then)" : ""}.` }
        : undefined,
    });
    // The customer agreed to pay after the job: never send a confirmation that leaves that out.
    const body = paymentMethod && !/\bafter\b/i.test(draft.body) ? `${draft.body}\n\n${fallbackPayLine(paymentMethod)}` : draft.body;
    return { subject: draft.subject, body };
  } catch (e) {
    console.warn("[booking] AI confirmation draft failed, using the plain-text template:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

function fallbackPayLine(method: PaymentMethod): string {
  return `Nothing to pay now: as agreed, we'll collect payment by ${PAYMENT_METHOD_CUSTOMER_LABEL[method]} once the job is done.`;
}

/** (Re)enqueue the day-before reminder. Skipped when the job starts within 24h (the confirmation covers it). */
export async function enqueueReminder(db: Db, job: Job): Promise<void> {
  if (!job.start_at) return;
  const runAfter = Date.parse(job.start_at) - DAY_MS;
  if (!(runAfter > Date.now())) return;
  const dedupeKey = `reminder:${job.id}`;
  // The dedupe key is unique across every status, so clear an old (finished or not-yet-run) reminder
  // from an earlier booking of this job; otherwise the new one would silently be a no-op.
  check(await db.from("fleet_tasks").delete().eq("dedupe_key", dedupeKey).in("status", ["queued", "done", "failed"]), "booking(clear old reminder)");
  await enqueueTask(db, { type: "followup_reminder", payload: { job_id: job.id }, runAfter: new Date(runAfter).toISOString(), dedupeKey });
}

/**
 * The customer side of a booking: one confirmation (email, or SMS for an opted-in customer with no
 * email) per booking of the job, and the day-before reminder. Idempotent: a confirmation already sent
 * for this booking is not sent again. Returns true when a confirmation went out.
 */
export async function completeBooking(db: Db, job: Job, ctx: { actor: string; siteUrl: string }): Promise<boolean> {
  const customer = await loadCustomer(db, job.customer_id);
  if (!customer) throw new Error(`completeBooking: customer ${job.customer_id} not found`);
  const quote = await loadQuote(db, job.quote_id);

  const existing = check(
    await db.from("messages").select("*").eq("job_id", job.id).eq("kind", "confirmation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "completeBooking(existing message)",
  );
  const alreadySent = existing?.status === "sent" && existing.sent_at !== null && existing.sent_at >= job.updated_at;
  let sent = alreadySent;
  if (!alreadySent) {
    const services = await servicesForJob(db, job);
    const draft = await draftConfirmation(db, customer, services, job, quote?.paid_at ? null : (quote?.payment_method ?? null));
    const channel = customer.email ? "email" : customer.sms_opt_in && customer.phone ? "sms" : "email";
    const fields = {
      customer_id: customer.id,
      job_id: job.id,
      quote_id: job.quote_id,
      channel,
      kind: "confirmation" as const,
      subject: draft.subject,
      body: draft.body,
      status: "queued" as const,
      error: null,
    } satisfies Partial<Message>;
    const message: Message =
      existing && existing.status !== "sent"
        ? one(await db.from("messages").update(fields).eq("id", existing.id).select("*").single(), "completeBooking(update message)")
        : one(await db.from("messages").insert(fields).select("*").single(), "completeBooking(insert message)");
    const result = await sendMessage(db, message.id, { siteUrl: ctx.siteUrl });
    sent = result.status === "sent";
    if (result.status !== "sent") console.warn(`[booking] confirmation for job ${job.id} not sent (${result.status}: ${result.error})`);
  }
  await enqueueReminder(db, job);
  return sent;
}

/** Re-send the availability emails that nobody answered (the "Ask crew again" button). */
export async function askCrewAgain(db: Db, jobId: string, opts: { siteUrl: string }): Promise<number> {
  const job = await loadJob(db, jobId);
  check(await db.from("job_assignments").update({ notified_at: null }).eq("job_id", jobId).eq("status", "offered"), "askCrewAgain(reset)");
  return notifyOffers(db, job, opts);
}

/** Rows that hold a crew member on the job (for callers that need the same definition as the scheduler). */
export const HOLDING: readonly AssignmentStatus[] = HOLDING_ASSIGNMENT_STATUSES;
