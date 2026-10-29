/**
 * End-to-end pipeline, in process: the phone-confirmed, pay-after-the-job flow.
 *
 *   form → quote task (auto quote + custom card; the job appears on the schedule's rail at once)
 *   → owner prices the custom item (job estimate refreshed) → owner drags the job onto Monday
 *   (crew emailed Available / Can't links, "Call Dana to confirm" card raised) → crew answer through
 *   their email links → owner calls Dana, books it (check, both crew; confirmation email + reminder)
 *   → crew start / complete (payouts + review task) → owner records the check (quote + job paid)
 *   → review request drafted (autopilot off: waits in the inbox) → autopilot on: sent by itself.
 *   Plus: a card customer gets the Stripe link emailed after the job and the webhook marks it paid.
 *
 * Real modules all the way through (lib/ops, approval handlers, lib/stripe, lib/email, lib/ai,
 * lib/scheduler, the fleet task dispatcher) against the in-memory fake DB. Only the edges are fake:
 *   - `@anthropic-ai/sdk`  → canned tool calls (so lib/ai/claude still validates + logs `ai_usage`)
 *   - `stripe`             → fake Checkout session; the webhook event is hand-built
 *   - global `fetch`       → captures what the Resend email provider would POST
 *   - `lib/geo`, `lib/weather` → nothing found
 * The clock is faked (Date only) so reminder timing and the review delay are deterministic.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  stripeCreate: vi.fn(),
  stripeRetrieve: vi.fn(),
  stripeExpire: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: m.anthropicCreate };
  },
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    static API_VERSION = "2026-09-30.test";
    checkout = { sessions: { create: m.stripeCreate, retrieve: m.stripeRetrieve, expire: m.stripeExpire } };
  },
}));

vi.mock("../geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../geo")>()),
  geocode: vi.fn(async () => null),
  lookupParcel: vi.fn(async () => null),
}));

vi.mock("../weather", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../weather")>()),
  getForecast: vi.fn(async () => null),
}));

import type Stripe from "stripe";
import { aiFor } from "../../fleet/context";
import type { TaskContext } from "../../fleet/context";
import { dispatch } from "../../fleet/tasks/index";
import { fleetDb, makeCtx } from "../../fleet/test-helpers";
import type { FleetFakeDb } from "../../fleet/test-helpers";
import { resetAnthropicClient } from "../ai/client";
import type {
  Approval,
  ApprovalKind,
  FleetRole,
  FleetTask,
  FleetTaskType,
  MinutesRule,
  OwnerWindow,
  Profile,
  Row,
  Service,
  TableName,
  Weekday,
} from "../db/types";
import {
  applyApproval,
  assignmentByToken,
  decideApproval,
  enqueueTask,
  getSettings,
  recordCrewResponse,
  scheduleJobAt,
  transitionJob,
  updateSettings,
  upsertCustomer,
} from "../ops";
import "../ops/handlers";
import { recordOfflinePayment } from "../ops/payments";
import { jobRow, settingsRow } from "../ops/test-utils";
import { zonedToUtc } from "../scheduler/time";
import { resetStripeClient } from "../stripe/client";
import { handleStripeEvent } from "../stripe/webhook";

// ---------- constants ----------

const SITE = "https://emmetts.test";
const OWNER = "owner-user";
/** Sunday Oct 18 2026, 8:00am EDT. The scheduler must skip Sunday (no owner window) → Monday. */
const SUNDAY = new Date("2026-10-18T12:00:00.000Z");
const T0 = "2026-01-01T00:00:00.000Z";
const id = () => crypto.randomUUID();

const rule = (base: number, per_acre: number): MinutesRule => ({
  base,
  per_acre,
  tree_cover: { none: 1, light: 1.15, medium: 1.3, heavy: 1.6 },
});

const MOWING: Service = {
  id: id(), created_at: T0, updated_at: T0, slug: "lawn-mowing", name: "Lawn mowing", active: true, auto_quote: true,
  default_crew_size: 1, minutes_rule: rule(45, 60), seasonal: "spring-summer", sort_order: 1,
};
const FALL: Service = {
  id: id(), created_at: T0, updated_at: T0, slug: "fall-cleanup", name: "Fall leaf cleanup", active: true, auto_quote: true,
  default_crew_size: 2, minutes_rule: rule(90, 120), seasonal: "fall", sort_order: 2,
};

const profile = (over: Partial<Profile>): Profile => ({
  id: id(), created_at: T0, updated_at: T0, user_id: id(), role: "crew", name: "Crew", email: null, phone: null,
  max_hours_week: 40, paused: false, hourly_rate: 20, removed_at: null, lat: null, lng: null, ...over,
});
const OWNER_PROFILE = profile({ role: "owner", name: "Emmett", email: "owner@example.test", hourly_rate: 0 });
const ANN = profile({ name: "Ann Lee", hourly_rate: 18, email: "ann@example.test" });
const BO = profile({ name: "Bo Diaz", hourly_rate: 20, email: "bo@example.test" });
/** Monday Oct 19 2026, 9:00–14:00 EDT: where the owner drags the job. */
const MONDAY_9 = zonedToUtc("2026-10-19", "09:00");
const MONDAY_14 = zonedToUtc("2026-10-19", "14:00");

const ownerWindows: OwnerWindow[] = ([1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) => ({
  id: id(), created_at: T0, updated_at: T0, weekday, start_time: "09:00", end_time: "18:00",
}));
const crewAvailability = [ANN, BO].flatMap((c) =>
  ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({
    id: id(), created_at: T0, updated_at: T0, crew_id: c.id, weekday, start_time: "08:00", end_time: "17:00",
  })),
);

const CUSTOM_NOTE = "Please also haul away the old brush pile behind the garage.";

// ---------- edge fakes ----------

type SentEmail = { to: string; subject: string; text: string };
const sent: SentEmail[] = [];

/** Canned structured output per AI tool. The quote body deliberately omits the pay link (the handler must add it). */
function cannedToolInput(tool: string, prompt: string): Record<string, unknown> {
  if (tool === "submit_request_summary") {
    return {
      summary: "Haul away a brush pile (about a pickup load) from behind the garage.",
      crew_size: 2, hours_min: 1.5, hours_max: 2.5, price_min: 100, price_max: 150, risks: ["tight side yard"],
    };
  }
  if (tool === "submit_message") {
    const kind = /kind: (\w+)/.exec(prompt)?.[1] ?? "custom";
    const copy: Record<string, { subject: string; body: string }> = {
      quote: { subject: "Your card payment link from Emmett's", body: "Hi Dana,\n\nThanks for having us out. Here is your card link." },
      confirmation: { subject: "You're booked with Emmett's", body: "Hi Dana,\n\nYou're on the schedule. See you then! We'll collect payment after the job." },
      review: { subject: "How did we do?", body: "Hi Dana,\n\nThanks for having us out. A quick review would mean a lot." },
      reminder: { subject: "See you tomorrow", body: "Hi Dana,\n\nJust a reminder that we're coming tomorrow." },
    };
    return copy[kind] ?? { subject: `About your ${kind}`, body: "Hi Dana,\n\nA note from Emmett's." };
  }
  throw new Error(`unexpected AI tool ${tool}`);
}

function installEdgeFakes() {
  m.anthropicCreate.mockImplementation(async (params: { model: string; tools: { name: string }[]; messages: { content: unknown }[] }) => {
    const tool = params.tools[0].name;
    const prompt = JSON.stringify(params.messages[0].content);
    return {
      id: `msg_${m.anthropicCreate.mock.calls.length}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "tool_use", id: `toolu_${m.anthropicCreate.mock.calls.length}`, name: tool, input: cannedToolInput(tool, prompt) }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  });

  m.stripeCreate.mockImplementation(async () => ({
    id: "cs_test_flow",
    url: "https://checkout.stripe.test/c/pay/cs_test_flow",
    status: "open",
  }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) !== "https://api.resend.com/emails") throw new Error(`unexpected network call: ${String(url)}`);
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
      sent.push({ to: body.to[0], subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
}

// ---------- shared state ----------

let db: FleetFakeDb;
const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "STRIPE_SECRET_KEY", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "BUSINESS_NAME", "REVIEW_URL"];
const savedEnv: Record<string, string | undefined> = {};

const rows = <T extends TableName>(t: T): Row<T>[] => (db.tables[t] ?? []) as unknown as Row<T>[];
const byId = <T extends TableName>(t: T, rowId: string): Row<T> => {
  const r = rows(t).find((x) => (x as { id: string }).id === rowId);
  if (!r) throw new Error(`${t} ${rowId} not found`);
  return r;
};
const approvalsOf = (kind: ApprovalKind) => rows("approvals").filter((a) => a.kind === kind);

function ctxFor(role: FleetRole, worker: string): TaskContext {
  return makeCtx(db, { role, worker, siteUrl: SITE, ai: aiFor(worker), now: () => new Date() });
}

/** What the worker loop does: claim due tasks of one type, dispatch (payload validated), mark done. */
async function runDue(type: FleetTaskType, ctx: TaskContext): Promise<Record<string, unknown>[]> {
  const nowIso = new Date().toISOString();
  const due = rows("fleet_tasks").filter((t) => t.type === type && t.status === "queued" && t.run_after <= nowIso);
  const out: Record<string, unknown>[] = [];
  for (const t of due) {
    Object.assign(t, { status: "running", worker: ctx.worker, attempts: (t.attempts ?? 0) + 1 });
    const result = await dispatch(ctx, t as FleetTask);
    await db.rpc("complete_task", { p_id: t.id, p_result: result });
    out.push(result);
  }
  return out;
}

async function decideAndApply(approvalId: string, patch?: Record<string, unknown>): Promise<Approval> {
  const decided = await decideApproval(db, approvalId, "approved", { decidedBy: OWNER, ...(patch ? { payloadPatch: patch } : {}) });
  expect(await applyApproval(db, decided, { siteUrl: SITE, actor: OWNER })).toBe(true);
  return byId("approvals", approvalId);
}

/** Emails captured for the customer only (crew availability emails go to the crew). */
const toDana = () => sent.filter((e) => e.to === "dana@example.com");

// Flow state carried between steps.
const flow = {
  customerId: "",
  leadId: "",
  quoteId: "",
  customItemId: "",
  customApprovalId: "",
  jobId: "",
  callCardId: "",
  reviewApprovalId: "",
};

describe("ops flow: form → estimate → drag onto calendar → crew answer → call & confirm → complete → collect → review", () => {
  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.ANTHROPIC_MODEL;
    process.env.STRIPE_SECRET_KEY = "sk_test_flow";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Emmett's <hello@emmetts.test>";
    delete process.env.BUSINESS_NAME;
    delete process.env.REVIEW_URL;
    resetAnthropicClient();
    resetStripeClient();
    vi.spyOn(console, "log").mockImplementation(() => {});
    installEdgeFakes();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SUNDAY);

    db = fleetDb({
      settings: [settingsRow({ default_wage: 15, margin: 0.5, min_job_price: null })],
      services: [MOWING, FALL],
      profiles: [OWNER_PROFILE, ANN, BO],
      owner_windows: ownerWindows,
      crew_availability: crewAvailability,
    });
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetAnthropicClient();
    resetStripeClient();
  });

  it("seeds the quote form submission (customer + lead + queued tasks), autopilot all off", async () => {
    const settings = await getSettings(db);
    expect(Object.values(settings.autopilot).every((r) => r.enabled === false)).toBe(true);

    // Mirrors app/actions/quote.ts: upsert customer, insert lead, enqueue quote + custom_summary.
    const customer = await upsertCustomer(db, {
      name: "Dana Whitfield", email: "Dana@Example.com", phone: "(440) 555-0199",
      address: "123 Lake Rd, Rocky River, OH 44116", email_opt_in: true,
    });
    flow.customerId = customer.id;
    const lead = (
      await db
        .from("leads")
        .insert({
          customer_id: customer.id, source: "web", utm: {}, requested_service_ids: [MOWING.id, FALL.id],
          custom_request: CUSTOM_NOTE, preferred_days: [], photo_paths: [], status: "new",
        })
        .select("*")
        .single()
    ).data!;
    flow.leadId = lead.id;
    await enqueueTask(db, { type: "quote", payload: { lead_id: lead.id }, dedupeKey: `quote:${lead.id}` });
    await enqueueTask(db, { type: "custom_summary", payload: { lead_id: lead.id }, dedupeKey: `custom_summary:${lead.id}` });

    expect(customer.email).toBe("dana@example.com");
    expect(rows("fleet_tasks").map((t) => t.type).sort()).toEqual(["custom_summary", "quote"]);
  });

  it("(a) quote task: standard items auto-priced, custom item needs the owner, job already on the rail, nothing sent", async () => {
    const ctx = ctxFor("quotes", "quotes-1");
    const [result] = await runDue("quote", ctx);
    expect(result).toMatchObject({ status: "needs_owner", items: 3, custom_items: 1 });

    const quote = rows("quotes").find((q) => q.lead_id === flow.leadId)!;
    flow.quoteId = quote.id;
    // 0.25 acre default lot, no tree cover: mowing 1 crew × 1 h, fall cleanup 2 crew × 2 h, $15/h, 50% margin.
    expect(quote).toMatchObject({ status: "needs_owner", price_total: 150, labor_total: 75, wage: 15, margin: 0.5 });
    expect(quote.paid_at ?? null).toBeNull();
    expect(quote.rationale).toMatch(/custom request/i);

    const items = rows("quote_items").filter((i) => i.quote_id === quote.id).sort((a, b) => a.sort_order - b.sort_order);
    expect(items.map((i) => [i.description, i.status, i.crew_size, i.est_hours, i.price])).toEqual([
      ["Lawn mowing", "auto", 1, 1, 30],
      ["Fall leaf cleanup", "auto", 2, 2, 120],
      [CUSTOM_NOTE, "needs_owner", 1, 0, null],
    ]);
    flow.customItemId = items[2].id;

    // The job exists from the estimate on: unpaid, waiting for a day, sized from the priced lines (60 + 120 min, crew 2).
    const jobs = rows("jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ quote_id: quote.id, customer_id: flow.customerId, status: "unscheduled", paid: false, paid_at: null, est_minutes: 180, crew_size: 2 });
    flow.jobId = jobs[0].id;
    expect(result).toMatchObject({ job_id: flow.jobId });

    // No "send the pay link" card: the owner calls the customer once a day is picked.
    expect(approvalsOf("quote")).toHaveLength(0);
    const [customCard] = approvalsOf("custom_item");
    expect(customCard).toMatchObject({ status: "pending", ref_table: "quote_items", ref_id: flow.customItemId });
    flow.customApprovalId = customCard.id;
    expect(byId("leads", flow.leadId).status).toBe("quoted");

    // The custom_summary task (queued by the form, de-duped against the quote task's enqueue) writes the
    // owner-only AI summary and refreshes the same card in place.
    const [summary] = await runDue("custom_summary", ctx);
    expect(summary).toMatchObject({ summary: true, quote_item_id: flow.customItemId });
    expect(byId("quote_items", flow.customItemId).ai_summary).toMatchObject({ crew_size: 2, price_min: 100, price_max: 150 });
    expect(approvalsOf("custom_item")).toHaveLength(1);
    expect(byId("approvals", flow.customApprovalId).summary).toMatch(/Suggested: 2 crew/);

    expect(sent).toHaveLength(0);
    expect(m.stripeCreate).not.toHaveBeenCalled();
  });

  it("(b) owner prices the custom item → item priced, totals recomputed, the rail job's estimate refreshed", async () => {
    const decided = await decideAndApply(flow.customApprovalId, { action: "price", price: 120, est_hours: 2, crew_size: 2 });
    expect(decided.status).toBe("approved");

    expect(byId("quote_items", flow.customItemId)).toMatchObject({ status: "priced", price: 120, est_hours: 2, crew_size: 2 });
    const quote = byId("quotes", flow.quoteId);
    // 30 + 120 + 120; labor 15 + 60 + (2 crew × 2 h × $15 = 60); fee 2.9% + $0.30.
    expect(quote).toMatchObject({ status: "draft", price_total: 270, labor_total: 135, fee_total: 8.13, profit_total: 126.87 });
    // Still one job, still on the rail, now 60 + 120 + 120 minutes.
    expect(rows("jobs")).toHaveLength(1);
    expect(byId("jobs", flow.jobId)).toMatchObject({ status: "unscheduled", est_minutes: 300, crew_size: 2 });
    expect(approvalsOf("quote")).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("(c) owner drags the job onto Monday 9am → crew emailed Available / Can't links, 'Call Dana to confirm' card raised", async () => {
    // Mirrors app/admin/actions/schedule.ts moveJob (owner-hours check passed: Mon 09:00–18:00).
    const res = await scheduleJobAt(db, flow.jobId, MONDAY_9, MONDAY_14, { actor: OWNER, siteUrl: SITE });
    expect(res).toMatchObject({ asked: 2, emailed: 2, reconfirm: false });

    const job = byId("jobs", flow.jobId);
    expect(job).toMatchObject({ status: "proposed", start_at: MONDAY_9.toISOString(), end_at: MONDAY_14.toISOString(), schedule_reason: `Placed by ${OWNER}` });

    const offers = rows("job_assignments").filter((a) => a.job_id === flow.jobId);
    expect(offers.map((a) => [a.crew_id, a.status, !!a.notified_at]).sort()).toEqual(
      [
        [ANN.id, "offered", true],
        [BO.id, "offered", true],
      ].sort(),
    );
    // Two crew emails, each with that crew member's own one-tap links; never the price.
    expect(sent.map((e) => e.to).sort()).toEqual(["ann@example.test", "bo@example.test"]);
    for (const email of sent) {
      const offer = offers.find((a) => a.crew_id === (email.to === "ann@example.test" ? ANN.id : BO.id))!;
      expect(email.subject).toBe("Are you free Mon Oct 19? Lawn mowing, Fall leaf cleanup, Please also haul away the old brush pile behind the garage. for Dana Whitfield");
      expect(email.text).toContain(`${SITE}/respond/${offer.respond_token}?r=available`);
      expect(email.text).toContain(`${SITE}/respond/${offer.respond_token}?r=cant`);
      expect(email.text).toContain("Mon Oct 19, 9:00am–2:00pm (5h)");
      expect(email.text).not.toContain("$");
    }
    expect(toDana()).toHaveLength(0);

    const [card] = approvalsOf("booking");
    expect(card).toMatchObject({ status: "pending", ref_table: "jobs", ref_id: flow.jobId, created_by: OWNER, title: "Call Dana Whitfield: Mon Oct 19, 9:00am–2:00pm" });
    expect(card.payload).toMatchObject({ job_id: flow.jobId, call_to_confirm: true, phone: "4405550199", price_total: 270 });
    expect(card.summary).toBe("$270, collected after the job · 2 crew, 5h · 0 of 2 crew asked said they're free");
    flow.callCardId = card.id;
  });

  it("(d) crew answer through their email links → crew_confirmed, the same card refreshed; nothing goes to the customer", async () => {
    // Mirrors app/respond/[token]: look the offer up by its token, record the answer.
    const offers = rows("job_assignments").filter((a) => a.job_id === flow.jobId);
    const ann = (await assignmentByToken(db, offers.find((a) => a.crew_id === ANN.id)!.respond_token))!;
    const bo = (await assignmentByToken(db, offers.find((a) => a.crew_id === BO.id)!.respond_token))!;
    expect(await recordCrewResponse(db, ann, "accepted", { siteUrl: SITE, actor: "crew-email" })).toMatchObject({ changed: true, confirmed: false });
    expect(byId("jobs", flow.jobId).status).toBe("proposed");
    expect(await recordCrewResponse(db, bo, "accepted", { siteUrl: SITE, actor: "crew-email" })).toMatchObject({ changed: true, confirmed: true });
    expect(byId("jobs", flow.jobId).status).toBe("crew_confirmed");

    expect(approvalsOf("booking")).toHaveLength(1); // refreshed in place, not duplicated
    const card = byId("approvals", flow.callCardId);
    expect(card.status).toBe("pending");
    expect(card.summary).toMatch(/2 of 2 crew asked said they're free/);
    expect(toDana()).toHaveLength(0);
    expect(byId("quotes", flow.quoteId).status).toBe("draft");
  });

  it("(e) owner calls Dana, books it (both crew, pays by check after the job) → booked, quote confirmed unpaid, lead won, confirmation + reminder", async () => {
    // Mirrors approving the call card with payment_method + crew_ids (the schedule dialog does the same through bookJob).
    const decided = await decideApproval(db, flow.callCardId, "edited", { decidedBy: OWNER, payloadPatch: { payment_method: "check", crew_ids: [ANN.id, BO.id] } });
    expect(await applyApproval(db, decided, { siteUrl: SITE, actor: OWNER })).toBe(true);

    const job = byId("jobs", flow.jobId);
    expect(job).toMatchObject({ status: "booked", crew_size: 2, paid: false, paid_at: null });
    expect(rows("job_assignments").filter((a) => a.job_id === flow.jobId).map((a) => a.status)).toEqual(["accepted", "accepted"]);

    const quote = byId("quotes", flow.quoteId);
    expect(quote).toMatchObject({ status: "accepted", payment_method: "check", fee_total: 0, profit_total: 135, accepted_at: SUNDAY.toISOString() });
    expect(quote.paid_at ?? null).toBeNull();
    expect(quote.rationale).toMatch(/Confirmed by phone \(owner-user\): Mon Oct 19, 9:00am–2:00pm, pays by check after the job\./);
    expect(byId("leads", flow.leadId).status).toBe("won");

    expect(toDana()).toHaveLength(1);
    expect(toDana()[0]).toMatchObject({ to: "dana@example.com", subject: "You're booked with Emmett's" });
    expect(rows("messages").find((x) => x.job_id === flow.jobId && x.kind === "confirmation")).toMatchObject({ status: "sent" });

    const reminders = rows("fleet_tasks").filter((t) => t.type === "followup_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ status: "queued", role: "followup", dedupe_key: `reminder:${flow.jobId}`, payload: { job_id: flow.jobId } });
    expect(Date.parse(reminders[0].run_after)).toBe(MONDAY_9.getTime() - 86_400_000);
    expect(m.stripeCreate).not.toHaveBeenCalled();
  });

  it("(f) the scheduler sweep leaves the owner's calendar alone (auto_schedule off) and nothing else is waiting", async () => {
    const [result] = await runDue("schedule", ctxFor("scheduler", "scheduler-1")).then((r) => (r.length ? r : [{ auto_place: false, proposed: 0 }]));
    expect(result).toMatchObject({ auto_place: false, proposed: 0 });
    expect(byId("jobs", flow.jobId)).toMatchObject({ status: "booked", start_at: MONDAY_9.toISOString() });
  });

  it("(g) crew start + complete → done with actual minutes, payouts, review task queued; the quote is still to collect", async () => {
    const job0 = byId("jobs", flow.jobId);
    vi.setSystemTime(Date.parse(job0.start_at!) + 5 * 60_000);
    await transitionJob(db, flow.jobId, "in_progress", { actor: `crew:${ANN.id}` });

    // Mirrors app/crew/actions/jobs.ts completeJob (4h50m on site).
    vi.setSystemTime(Date.parse(job0.start_at!) + 295 * 60_000);
    const actualMinutes = 290;
    await db.from("jobs").update({ actual_minutes: actualMinutes }).eq("id", flow.jobId);
    await transitionJob(db, flow.jobId, "done", { actor: `crew:${ANN.id}` });
    const accepted = rows("job_assignments").filter((a) => a.job_id === flow.jobId && a.status === "accepted");
    const hours = Math.round((actualMinutes / 60) * 100) / 100;
    await db.from("payouts").insert(
      accepted.map((a) => {
        const rate = byId("profiles", a.crew_id).hourly_rate;
        return { crew_id: a.crew_id, job_id: flow.jobId, hours, rate, amount: Math.round(hours * rate * 100) / 100, paid_cash_at: null };
      }),
    );
    await enqueueTask(db, {
      type: "followup_review",
      payload: { job_id: flow.jobId },
      runAfter: new Date(Date.now() + 86_400_000).toISOString(),
      dedupeKey: `review:${flow.jobId}`,
    });

    const job = byId("jobs", flow.jobId);
    expect(job).toMatchObject({ status: "done", actual_minutes: 290, paid: false });
    expect(job.started_at).toBe(new Date(Date.parse(job0.start_at!) + 5 * 60_000).toISOString());
    expect(job.completed_at).toBe(new Date().toISOString());
    expect(rows("payouts").map((p) => [p.crew_id, p.hours, p.amount]).sort()).toEqual(
      [
        [ANN.id, 4.83, 86.94],
        [BO.id, 4.83, 96.6],
      ].sort(),
    );
    expect(byId("quotes", flow.quoteId).status).toBe("accepted");
    expect(byId("quotes", flow.quoteId).paid_at ?? null).toBeNull();
    // Not due yet: the worker loop leaves it alone.
    expect(await runDue("followup_review", ctxFor("followup", "followup-1"))).toEqual([]);
  });

  it("(h) Dana hands over a check → quote paid (no card fee), job paid; nothing emailed, nothing scheduled", async () => {
    // Mirrors the quote page's "Record cash / check".
    const before = rows("fleet_tasks").length;
    const res = await recordOfflinePayment(db, flow.quoteId, { method: "check", amount: 270, checkNumber: "1042", recordedBy: OWNER });
    expect(res.jobId).toBe(flow.jobId);
    const quote = byId("quotes", flow.quoteId);
    expect(quote).toMatchObject({ status: "accepted", payment_method: "check", fee_total: 0, profit_total: 135 });
    expect(quote.paid_at).toBe(new Date().toISOString());
    expect(quote.accepted_at).toBe(SUNDAY.toISOString()); // the phone confirmation stands
    expect(quote.rationale).toMatch(/Paid by check #1042: \$270\.00, recorded by owner-user\./);
    expect(byId("jobs", flow.jobId)).toMatchObject({ status: "done", paid: true });
    expect(rows("jobs")).toHaveLength(1);
    expect(rows("fleet_tasks")).toHaveLength(before); // a done job is not sent to the scheduler
    expect(toDana()).toHaveLength(1);
    expect(m.stripeCreate).not.toHaveBeenCalled();
  });

  it("(i) review task a day later → review drafted + followup card pending, nothing sent", async () => {
    vi.setSystemTime(Date.now() + 86_400_000 + 60_000);
    const [result] = await runDue("followup_review", ctxFor("followup", "followup-1"));
    expect(result).toMatchObject({ auto_sent: false, draft: "ai" });

    const review = rows("messages").find((x) => x.job_id === flow.jobId && x.kind === "review")!;
    expect(review).toMatchObject({ status: "draft", channel: "email", subject: "How did we do?" });
    const card = approvalsOf("followup").find((a) => a.ref_id === review.id)!;
    expect(card).toMatchObject({ status: "pending", ref_table: "messages", created_by: "followup-1" });
    expect(card.payload).toMatchObject({ message_id: review.id, kind: "review", job_id: flow.jobId });
    flow.reviewApprovalId = card.id;
    expect(toDana()).toHaveLength(1);
  });

  it("(j) with followup autopilot on, a second finished job's review request is sent by itself", async () => {
    await updateSettings(db, { autopilot: { followup: { enabled: true } } });
    const second = jobRow({
      customer_id: flow.customerId, quote_id: flow.quoteId, status: "done", completed_at: new Date().toISOString(),
      start_at: null, end_at: null, est_minutes: 60,
    });
    await db.from("jobs").insert(second);
    await enqueueTask(db, { type: "followup_review", payload: { job_id: second.id }, dedupeKey: `review:${second.id}` });

    const [result] = await runDue("followup_review", ctxFor("followup", "followup-1"));
    expect(result).toMatchObject({ auto_sent: true });

    const review = rows("messages").find((x) => x.job_id === second.id && x.kind === "review")!;
    expect(review.status).toBe("sent");
    const card = approvalsOf("followup").find((a) => a.ref_id === review.id)!;
    expect(card).toMatchObject({ status: "approved", decided_by: "autopilot" });
    expect(toDana()).toHaveLength(2);
    expect(toDana()[1]).toMatchObject({ to: "dana@example.com", subject: "How did we do?" });
    // The first job's review is still waiting for the owner.
    expect(byId("approvals", flow.reviewApprovalId).status).toBe("pending");
  });

  it("(k) a card customer: the Stripe link is emailed after the job and the webhook marks the quote paid", async () => {
    // A second, phone-confirmed quote whose customer said "card". Its job is done; the owner emails the link.
    const q2 = (
      await db
        .from("quotes")
        .insert({
          lead_id: flow.leadId, customer_id: flow.customerId, status: "accepted", price_total: 90, labor_total: 45, fee_total: 2.91, profit_total: 42.09,
          margin: 0.5, wage: 15, payment_method: "stripe", accepted_at: new Date().toISOString(), paid_at: null, sent_at: null, expires_at: null, rationale: null,
          stripe_checkout_id: null, stripe_checkout_url: null, stripe_payment_intent_id: null, stripe_invoice_id: null, stripe_invoice_url: null,
        })
        .select("*")
        .single()
    ).data!;
    await db.from("quote_items").insert({ quote_id: q2.id, service_id: MOWING.id, description: "Lawn mowing", is_custom: false, crew_size: 1, est_hours: 1, price: 90, status: "auto", sort_order: 0 });
    const job2 = jobRow({ customer_id: flow.customerId, quote_id: q2.id, status: "done", paid: false, paid_at: null, completed_at: new Date().toISOString(), est_minutes: 60 });
    await db.from("jobs").insert(job2);

    // Mirrors the quote page's "Email card link": a quote approval approved by the owner, handled by quoteHandler.
    const { approval } = { approval: (await db.from("approvals").insert({ kind: "quote", ref_table: "quotes", ref_id: q2.id, payload: { quote_id: q2.id, method: "checkout" }, title: "Card link", summary: null, created_by: OWNER, status: "pending", decided_at: null, decided_by: null, decision_note: null }).select("*").single()).data! };
    const decided = await decideApproval(db, approval.id, "approved", { decidedBy: OWNER });
    expect(await applyApproval(db, decided, { siteUrl: SITE, actor: OWNER })).toBe(true);
    expect(m.stripeCreate).toHaveBeenCalledTimes(1);
    const link = toDana()[toDana().length - 1];
    expect(link.subject).toBe("Your card payment link from Emmett's");
    expect(link.text).toContain(`${SITE}/quote/pay/${q2.id}`);
    expect(byId("quotes", q2.id)).toMatchObject({ status: "accepted", paid_at: null, stripe_checkout_id: "cs_test_flow" });

    // The card payment lands.
    const event = {
      id: "evt_test_flow_card",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_flow", object: "checkout.session", payment_status: "paid", status: "complete", amount_total: 9000,
          payment_intent: "pi_test_flow", client_reference_id: q2.id, metadata: { quote_id: q2.id, customer_id: flow.customerId },
        },
      },
    } as unknown as Stripe.Event;
    expect(await handleStripeEvent(db, event, { siteUrl: SITE })).toEqual({ duplicate: false, processed: true });
    expect(byId("quotes", q2.id)).toMatchObject({ status: "accepted", payment_method: "stripe", stripe_payment_intent_id: "pi_test_flow" });
    expect(byId("quotes", q2.id).paid_at).toBe(new Date().toISOString());
    expect(byId("jobs", job2.id)).toMatchObject({ status: "done", paid: true });
    expect(rows("jobs").filter((j) => j.quote_id === q2.id)).toHaveLength(1); // no second job for the payment
    // Redelivery is a no-op.
    expect(await handleStripeEvent(db, event, { siteUrl: SITE })).toEqual({ duplicate: true, processed: true });
  });

  it("ledger: every AI call is logged in ai_usage, and nothing reached the customer without an approved card", () => {
    const calls = m.anthropicCreate.mock.calls.length;
    expect(calls).toBe(5);
    const usage = rows("ai_usage");
    expect(usage).toHaveLength(calls);
    expect(usage.map((u) => [u.task, u.worker])).toEqual([
      ["summarize_custom_request", "quotes-1"],
      ["draft_message_confirmation", null],
      ["draft_message_review", "followup-1"],
      ["draft_message_review", "followup-1"],
      ["draft_message_quote", null],
    ]);
    expect(usage.every((u) => u.model === "claude-sonnet-5-5" && u.input_tokens === 1200 && u.est_cost > 0)).toBe(true);

    // Crew availability emails are not customer messages (and carry no price); everything to Dana is.
    const sentMessages = rows("messages").filter((x) => x.status === "sent");
    expect(sentMessages).toHaveLength(toDana().length);
    for (const email of toDana()) {
      const msg = sentMessages.find((x) => x.subject === email.subject && email.text.startsWith(x.body.trim()));
      expect(msg, `captured email "${email.subject}" has no sent message row`).toBeDefined();
      const card =
        msg!.kind === "quote"
          ? approvalsOf("quote").find((a) => a.ref_id === msg!.quote_id)
          : msg!.kind === "confirmation"
            ? approvalsOf("booking").find((a) => a.ref_id === msg!.job_id)
            : approvalsOf("followup").find((a) => a.ref_id === msg!.id);
      expect(card, `no approval for ${msg!.kind} message ${msg!.id}`).toBeDefined();
      expect(["approved", "edited"]).toContain(card!.status);
    }
    // Drafts still waiting on the owner were never handed to the provider.
    const drafts = rows("messages").filter((x) => x.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "review", job_id: flow.jobId });
    expect(drafts[0].sent_at ?? null).toBeNull();
    expect(drafts[0].provider_id ?? null).toBeNull();
    // Every card in the inbox is accounted for: the call card was approved with the booking.
    expect(rows("approvals").map((a) => `${a.kind}:${a.status}`).sort()).toEqual(
      ["booking:edited", "custom_item:approved", "followup:approved", "followup:pending", "quote:approved"].sort(),
    );
  });
});
