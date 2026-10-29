/**
 * Crew availability polling. When a job goes on the calendar every crew member who could work that
 * slot gets an offer row (`job_assignments`, status `offered`) and an email with two links, Available /
 * Can't make it, that work without a login (`respond_token`). Their answers show on the schedule and on
 * the "Call <customer> to confirm" card; the owner picks the crew when they book the job.
 *
 * Plain Node (relative imports, no `server-only`): the fleet scheduler uses it too.
 */
import { randomBytes } from "node:crypto";
import type { AssignmentStatus, CrewAvailability, CrewException, Job, JobAssignment, Profile } from "../db/types";
import { escapeHtml, getEmailProvider } from "../email";
import { covers, crewAvailableForDay, HOLDING_ASSIGNMENT_STATUSES, overlaps } from "../scheduler/capacity";
import { formatDayLabel, formatDuration, formatTimeRange, localDate } from "../scheduler/time";
import { siteConfig } from "../site-config";
import { servicesForJob } from "./jobs";
import { check, one } from "./types";
import type { Db } from "./types";

export type CrewSkipReason = "paused" | "removed" | "unavailable" | "time_off" | "busy";

/** The per-offer token in the email links (32 hex chars; the DB has the same default, set here so every client agrees). */
export function newRespondToken(): string {
  return randomBytes(16).toString("hex");
}

/** A holding assignment on some other job, with that job's times. */
export type BusyRow = { crew_id: string; job_id: string; status: AssignmentStatus; start_at: string | null; end_at: string | null };

export type EligibleCrewInput = {
  crew: Profile[];
  start: Date;
  end: Date;
  crewAvailability: CrewAvailability[];
  /** Any status; only `approved` rows count. */
  crewExceptions: CrewException[];
  busy: BusyRow[];
  /** The job being placed: its own rows never make anyone busy. */
  jobId?: string;
};

export type EligibleCrew = { eligible: Profile[]; skipped: { crew: Profile; why: CrewSkipReason }[] };

/**
 * Who to ask about a slot. Removed and paused crew are never asked. A crew member who set weekly hours
 * is asked only when those hours (minus approved time off, plus approved extra days) cover the slot;
 * one who never set any hours is asked anyway (they answer the email). Nobody already holding another
 * job at the same time is asked.
 */
export function eligibleCrewForSlot(input: EligibleCrewInput): EligibleCrew {
  const s = input.start.getTime();
  const e = input.end.getTime();
  const date = localDate(input.start);
  const eligible: Profile[] = [];
  const skipped: EligibleCrew["skipped"] = [];
  for (const c of input.crew) {
    if (c.role !== "crew") continue;
    if (c.removed_at) {
      skipped.push({ crew: c, why: "removed" });
      continue;
    }
    if (c.paused) {
      skipped.push({ crew: c, why: "paused" });
      continue;
    }
    const busy = input.busy.some(
      (a) =>
        a.crew_id === c.id &&
        a.job_id !== input.jobId &&
        HOLDING_ASSIGNMENT_STATUSES.includes(a.status) &&
        a.start_at &&
        a.end_at &&
        overlaps([{ start: Date.parse(a.start_at), end: Date.parse(a.end_at) }], s, e),
    );
    if (busy) {
      skipped.push({ crew: c, why: "busy" });
      continue;
    }
    const hasHours = input.crewAvailability.some((b) => b.crew_id === c.id);
    if (hasHours) {
      const approved = input.crewExceptions.filter((x) => x.crew_id === c.id && x.status === "approved");
      if (!covers(crewAvailableForDay(c.id, date, input.crewAvailability, approved), s, e)) {
        const weekly = crewAvailableForDay(c.id, date, input.crewAvailability, []);
        skipped.push({ crew: c, why: covers(weekly, s, e) ? "time_off" : "unavailable" });
        continue;
      }
    }
    eligible.push(c);
  }
  return { eligible, skipped };
}

const LIVE_JOB_STATUSES: Job["status"][] = ["proposed", "crew_confirmed", "booked", "in_progress"];

/** Everything `eligibleCrewForSlot` needs, read from the database (filters applied in JS: the sets are small). */
export async function loadEligibilityInput(db: Db, job: Pick<Job, "id" | "start_at" | "end_at">): Promise<EligibleCrewInput> {
  if (!job.start_at || !job.end_at) throw new Error("loadEligibilityInput: the job has no slot");
  const start = new Date(job.start_at);
  const end = new Date(job.end_at);
  const [crewRes, availRes, excRes, jobsRes] = await Promise.all([
    db.from("profiles").select("*").eq("role", "crew").is("removed_at", null),
    db.from("crew_availability").select("*"),
    db.from("crew_exceptions").select("*").eq("status", "approved"),
    db.from("jobs").select("*").in("status", LIVE_JOB_STATUSES),
  ]);
  const crew = check(crewRes, "eligibility(crew)") ?? [];
  const others = (check(jobsRes, "eligibility(jobs)") ?? []).filter(
    (j) => j.id !== job.id && j.start_at && j.end_at && Date.parse(j.start_at) < end.getTime() && Date.parse(j.end_at) > start.getTime(),
  );
  const rows = others.length
    ? check(await db.from("job_assignments").select("*").in("job_id", others.map((j) => j.id)), "eligibility(assignments)") ?? []
    : [];
  const times = new Map(others.map((j) => [j.id, j]));
  return {
    crew,
    start,
    end,
    crewAvailability: check(availRes, "eligibility(availability)") ?? [],
    crewExceptions: check(excRes, "eligibility(exceptions)") ?? [],
    busy: rows.map((a) => ({ crew_id: a.crew_id, job_id: a.job_id, status: a.status, start_at: times.get(a.job_id)!.start_at, end_at: times.get(a.job_id)!.end_at })),
    jobId: job.id,
  };
}

export type PollResult = {
  /** Crew now holding an `offered` / `accepted` row on the job. */
  asked: string[];
  emailed: number;
  skipped: { crew_id: string; name: string; why: CrewSkipReason }[];
};

/**
 * Put (or refresh) the availability offers for a job on the calendar.
 *
 * `reset: true` (the job was just placed or moved): every eligible crew member is asked afresh
 * (existing rows go back to `offered`, answers cleared), rows of crew who can't make the new slot are
 * removed, swap offers are withdrawn. `reset: false` (top up): only eligible crew without a row are
 * added; existing answers stand. Then everyone with an unsent offer is emailed.
 */
export async function pollCrewForJob(db: Db, job: Job, opts: { siteUrl: string; reset: boolean }): Promise<PollResult> {
  if (!job.start_at || !job.end_at) throw new Error("pollCrewForJob: the job is not on the calendar");
  const input = await loadEligibilityInput(db, job);
  const { eligible, skipped } = eligibleCrewForSlot(input);
  const eligibleIds = new Set(eligible.map((c) => c.id));
  const existing = check(await db.from("job_assignments").select("*").eq("job_id", job.id), "poll(existing)") ?? [];

  const fresh = { status: "offered" as const, responded_at: null, swap_to_crew_id: null, notified_at: null };
  const have = new Set<string>();
  for (const row of existing) {
    if (opts.reset) {
      if (row.status === "swap_offered" || !eligibleIds.has(row.crew_id)) {
        check(await db.from("job_assignments").delete().eq("id", row.id), "poll(remove)");
        continue;
      }
      check(await db.from("job_assignments").update(fresh).eq("id", row.id), "poll(reset)");
    }
    have.add(row.crew_id);
  }
  for (const c of eligible) {
    if (have.has(c.id)) continue;
    check(await db.from("job_assignments").insert({ job_id: job.id, crew_id: c.id, respond_token: newRespondToken(), ...fresh }), "poll(offer)");
  }

  const emailed = await notifyOffers(db, job, { siteUrl: opts.siteUrl });
  const asked = (check(await db.from("job_assignments").select("*").eq("job_id", job.id), "poll(after)") ?? [])
    .filter((a) => a.status === "offered" || a.status === "accepted")
    .map((a) => a.crew_id);
  return { asked, emailed, skipped: skipped.map((s) => ({ crew_id: s.crew.id, name: s.crew.name, why: s.why })) };
}

/** Ask again: the offers nobody answered are emailed once more. Returns how many went out. */
export async function remindOffers(db: Db, job: Job, opts: { siteUrl: string }): Promise<number> {
  check(await db.from("job_assignments").update({ notified_at: null }).eq("job_id", job.id).eq("status", "offered"), "remind(reset)");
  return notifyOffers(db, job, opts);
}

/**
 * Email every `offered` row on the job that hasn't been emailed yet (`notified_at` null) and mark it.
 * A crew member without an email address is skipped (they still see the offer in the crew app). Provider
 * failures are logged, never thrown: the job is on the calendar either way.
 */
export async function notifyOffers(db: Db, job: Job, opts: { siteUrl: string }): Promise<number> {
  const rows = (check(await db.from("job_assignments").select("*").eq("job_id", job.id), "notify(rows)") ?? []).filter(
    (a) => a.status === "offered" && !a.notified_at,
  );
  if (!rows.length) return 0;
  const [profiles, customer, services] = await Promise.all([
    db.from("profiles").select("*").in("id", rows.map((r) => r.crew_id)),
    db.from("customers").select("*").eq("id", job.customer_id).maybeSingle(),
    servicesForJob(db, job),
  ]);
  const byId = new Map((check(profiles, "notify(profiles)") ?? []).map((p) => [p.id, p]));
  const cust = check(customer, "notify(customer)");
  const provider = getEmailProvider();
  let sent = 0;
  for (const row of rows) {
    const crew = byId.get(row.crew_id);
    const now = new Date().toISOString();
    if (!crew?.email) {
      // Nothing to send; don't ask again on the next pass either.
      check(await db.from("job_assignments").update({ notified_at: now }).eq("id", row.id), "notify(no email)");
      continue;
    }
    const mail = crewOfferEmail({
      crewName: crew.name,
      customerName: cust?.name ?? "a customer",
      address: cust?.address ?? null,
      services,
      job,
      token: row.respond_token,
      siteUrl: opts.siteUrl,
    });
    try {
      await provider.send({ to: crew.email, subject: mail.subject, text: mail.text, html: mail.html });
      sent++;
    } catch (e) {
      console.error(`[crew-offers] could not email ${crew.email} about job ${job.id}:`, e instanceof Error ? e.message : e);
      continue; // left un-marked: the next pass (or "Ask again") retries
    }
    check(await db.from("job_assignments").update({ notified_at: now }).eq("id", row.id), "notify(mark)");
  }
  return sent;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export function respondUrl(siteUrl: string, token: string, response: "available" | "cant"): string {
  return `${siteUrl.replace(/\/+$/, "")}/respond/${encodeURIComponent(token)}?r=${response}`;
}

/** "Tue Nov 4, 9:00–10:30am (1h 30m)" */
export function slotLabel(job: Pick<Job, "start_at" | "end_at" | "est_minutes">): string {
  if (!job.start_at) return "a day to be confirmed";
  const start = new Date(job.start_at);
  const end = job.end_at ? new Date(job.end_at) : new Date(start.getTime() + job.est_minutes * 60_000);
  return `${formatDayLabel(start)}, ${formatTimeRange(start, end)} (${formatDuration(Math.round((end.getTime() - start.getTime()) / 60_000))})`;
}

/** The availability request. Plain text plus a small HTML version with two big buttons. */
export function crewOfferEmail(input: {
  crewName: string;
  customerName: string;
  address: string | null;
  services: string[];
  job: Pick<Job, "start_at" | "end_at" | "est_minutes" | "crew_size">;
  token: string;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const when = slotLabel(input.job);
  const what = input.services.length ? input.services.join(", ") : "a job";
  const yes = respondUrl(input.siteUrl, input.token, "available");
  const no = respondUrl(input.siteUrl, input.token, "cant");
  const app = `${input.siteUrl.replace(/\/+$/, "")}/crew/offers`;
  const crewLine = input.job.crew_size > 1 ? `Crew of ${input.job.crew_size}.` : "One person.";
  const subject = `Are you free ${input.job.start_at ? formatDayLabel(new Date(input.job.start_at)) : "for a job"}? ${what} for ${input.customerName}`;
  const text = [
    `Hi ${firstName(input.crewName)},`,
    "",
    `${siteConfig.name} has a job that might be yours:`,
    "",
    `  ${what} for ${input.customerName}`,
    `  ${when}`,
    input.address ? `  ${input.address}` : null,
    `  ${crewLine}`,
    "",
    `Can you make it? Tap one:`,
    `  Available:      ${yes}`,
    `  Can't make it:  ${no}`,
    "",
    `Saying you're available isn't a commitment yet: the owner confirms the day with the customer, then picks the crew and you'll see it in the app (${app}).`,
    "",
    "Thanks,",
    siteConfig.name,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const btn = (href: string, label: string, bg: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:14px 22px;border-radius:8px;background:${bg};color:#ffffff;font-weight:600;text-decoration:none;font-size:16px;">${escapeHtml(label)}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:16px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;">
<tr><td style="padding:20px 24px;background:#166534;color:#ffffff;font-size:18px;font-weight:600;border-radius:8px 8px 0 0;">${escapeHtml(siteConfig.name)}</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5;color:#1f2937;">
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName(input.crewName))},</p>
<p style="margin:0 0 16px;">There's a job that might be yours:</p>
<p style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;"><strong>${escapeHtml(what)}</strong> for ${escapeHtml(input.customerName)}<br>${escapeHtml(when)}${input.address ? `<br>${escapeHtml(input.address)}` : ""}<br>${escapeHtml(crewLine)}</p>
<p style="margin:0 0 8px;"><strong>Can you make it?</strong></p>
<p style="margin:0 0 16px;">${btn(yes, "I'm available", "#166534")}${btn(no, "Can't make it", "#6b7280")}</p>
<p style="margin:0;font-size:14px;color:#6b7280;">Saying you're available isn't a commitment yet: the owner confirms the day with the customer, then picks the crew and you'll see it in the <a href="${escapeHtml(app)}" style="color:#166534;">crew app</a>.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

/** The offer row for a token link, or null. */
export async function assignmentByToken(db: Db, token: string): Promise<JobAssignment | null> {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  return check(await db.from("job_assignments").select("*").eq("respond_token", token).maybeSingle(), "assignmentByToken");
}

/** Convenience for callers that hold only an id. */
export async function loadJob(db: Db, jobId: string): Promise<Job> {
  return one(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), `job ${jobId}`);
}
