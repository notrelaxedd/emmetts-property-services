/**
 * Phase 9 end-to-end flow in a real browser, against a real Supabase project + Stripe TEST keys:
 *
 *   /quote form → quote task → owner prices the custom item + approves the quote in /admin →
 *   signed `checkout.session.completed` POSTed to /api/stripe/webhook → job on /admin/schedule →
 *   schedule task → crew accepts in /crew/offers → owner books in /admin → crew starts + completes
 *   in /crew/jobs/<id> → review task → review card in /admin.
 *
 * Fleet tasks run IN PROCESS (the same `dispatch` the worker uses, with a service-role client), so
 * no fleet box is needed. With a worker running too (`FLEET_ROLE=quotes npm run fleet`, etc.) the
 * test still passes: it claims a task only while it is `queued` and otherwise waits for the worker.
 *
 * Use a THROWAWAY Supabase project: the scheduler sweeps every unscheduled job and offers work to any
 * crew member, and the test seeds owner windows when there are none.
 *
 * Env (test runner):
 *   E2E_SUPABASE_SERVICE_ROLE_KEY  required   service-role key of the test project
 *   E2E_SUPABASE_URL               optional   defaults to SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   E2E_OWNER_EMAIL                required   owner login (profile ensured, kept afterwards)
 *   E2E_CREW_EMAIL                 optional   crew login; default: a fresh user that is deleted afterwards
 *   STRIPE_WEBHOOK_SECRET          required   the same whsec_... the app server verifies with
 *   ANTHROPIC_API_KEY              optional   without it the review draft falls back to the template
 * The app server (E2E_BASE_URL or `next start` from playwright.config.ts) needs the same Supabase
 * project, STRIPE_SECRET_KEY (sk_test_...) and STRIPE_WEBHOOK_SECRET; EMAIL_PROVIDER can stay `log`.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import Stripe from "stripe";
import { aiFor, type TaskContext } from "../fleet/context";
import { createFleetDb } from "../fleet/db";
import { createLogger } from "../fleet/log";
import { dispatch } from "../fleet/tasks/index";
import type { FleetRole, FleetTask, FleetTaskType, Weekday } from "../lib/db/types";
import type { Db } from "../lib/ops/types";

const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CUSTOMER_NAME = `E2E Flow ${RUN}`;
const CUSTOMER_EMAIL = `e2e-flow-${RUN}@example.com`;
const CUSTOM_NOTE = `E2E ${RUN}: please also haul away the brush pile behind the garage.`;
const CREW_EMAIL = process.env.E2E_CREW_EMAIL ?? `e2e-crew-${RUN}@example.com`;
const WORKER = `e2e-${RUN}`;

const POLL = { timeout: 60_000, intervals: [500, 1_000, 2_000] };

test.describe("ops flow (real Supabase + Stripe test mode)", () => {
  test.skip(!SERVICE_KEY || !OWNER_EMAIL, "needs a real Supabase project (E2E_SUPABASE_SERVICE_ROLE_KEY + E2E_OWNER_EMAIL)");
  test.skip(!SUPABASE_URL, "needs E2E_SUPABASE_URL (or SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)");
  test.skip(!WEBHOOK_SECRET, "needs STRIPE_WEBHOOK_SECRET (the same one the app server uses)");
  test.describe.configure({ mode: "serial" });

  let db: Db;
  /** The e2e crew member's profile id (whether or not this run created it). */
  let crewId = "";
  /** Everything this run created, for afterAll. */
  const created = {
    customerId: null as string | null,
    leadId: null as string | null,
    quoteId: null as string | null,
    jobId: null as string | null,
    stripeEventIds: [] as string[],
    ownerWindowIds: [] as string[],
    crewAvailabilityIds: [] as string[],
    crewProfileId: null as string | null,
    crewUserId: null as string | null,
  };

  // ---------- setup helpers ----------

  /** Creates the auth user if needed (confirmed, no email sent) and returns its id. */
  async function ensureAuthUser(email: string): Promise<{ id: string; created: boolean }> {
    const res = await db.auth.admin.createUser({ email, email_confirm: true });
    if (res.data.user) return { id: res.data.user.id, created: true };
    if (res.error && !/already|registered|exists/i.test(res.error.message)) throw res.error;
    const link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error || !link.data.user) throw link.error ?? new Error(`no auth user for ${email}`);
    return { id: link.data.user.id, created: false };
  }

  async function ensureProfile(userId: string, role: "owner" | "crew", name: string, email: string): Promise<{ id: string; created: boolean }> {
    const { data: existing, error } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (existing) {
      if (existing.role !== role) throw new Error(`${email} already has a ${existing.role} profile; the e2e needs it to be ${role}`);
      return { id: existing.id, created: false };
    }
    const { data, error: insErr } = await db
      .from("profiles")
      .insert({ user_id: userId, role, name, email, max_hours_week: 40, paused: false, hourly_rate: role === "crew" ? 20 : 0 })
      .select("id")
      .single();
    if (insErr || !data) throw insErr ?? new Error("profile insert returned nothing");
    return { id: data.id, created: true };
  }

  /** Signs a browser context in through the real callback route with an admin-generated magic link. */
  async function signIn(page: Page, email: string, next: string): Promise<void> {
    const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const tokenHash = data.properties.hashed_token;
    await page.goto(`/api/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(new RegExp(`${next.replace(/\//g, "\\/")}(\\?|$)`), { timeout: 30_000 });
  }

  async function newSignedInPage(browser: Browser, email: string, next: string): Promise<Page> {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await signIn(page, email, next);
    return page;
  }

  function ctxFor(role: FleetRole): TaskContext {
    return { db, worker: WORKER, role, siteUrl: BASE_URL, ai: aiFor(WORKER), log: createLogger({ worker: WORKER }), now: () => new Date() };
  }

  /**
   * Runs one queued task in process, exactly like the worker loop: claim it (queued → running),
   * dispatch, `complete_task`. If a real worker already claimed it, waits for that worker instead.
   */
  async function runTask(type: FleetTaskType, dedupeKey: string, role: FleetRole): Promise<void> {
    let task: FleetTask | null = null;
    await expect
      .poll(async () => {
        const { data } = await db.from("fleet_tasks").select("*").eq("dedupe_key", dedupeKey).maybeSingle();
        task = data;
        return data?.status ?? null;
      }, { ...POLL, message: `${type} task ${dedupeKey} was never queued` })
      .not.toBeNull();
    const { data: claimed } = await db
      .from("fleet_tasks")
      .update({ status: "running", worker: WORKER, started_at: new Date().toISOString() })
      .eq("id", task!.id)
      .eq("status", "queued")
      .select("*");
    if (claimed?.length) {
      const result = await dispatch(ctxFor(role), claimed[0]);
      const { error } = await db.rpc("complete_task", { p_id: claimed[0].id, p_result: result });
      if (error) throw error;
      return;
    }
    await expect
      .poll(async () => (await db.from("fleet_tasks").select("status").eq("id", task!.id).single()).data?.status, {
        ...POLL,
        message: `a fleet worker claimed ${type} but never finished it`,
      })
      .toBe("done");
  }

  async function card(page: Page, title: RegExp) {
    await page.goto("/admin");
    const c = page.getByRole("article", { name: title });
    await expect(c).toBeVisible({ timeout: 30_000 });
    return c;
  }

  // ---------- lifecycle ----------

  test.beforeAll(async () => {
    db = createFleetDb(SUPABASE_URL!, SERVICE_KEY!);

    const owner = await ensureAuthUser(OWNER_EMAIL!);
    await ensureProfile(owner.id, "owner", "Owner (e2e)", OWNER_EMAIL!);

    const crewUser = await ensureAuthUser(CREW_EMAIL);
    if (crewUser.created) created.crewUserId = crewUser.id;
    const crew = await ensureProfile(crewUser.id, "crew", `E2E Crew ${RUN}`, CREW_EMAIL);
    crewId = crew.id;
    if (crew.created) created.crewProfileId = crew.id;
    // Available every day, all day, so the job can land in whatever owner window comes first.
    const { data: avail, error: availErr } = await db
      .from("crew_availability")
      .insert(([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) => ({ crew_id: crew.id, weekday, start_time: "00:00", end_time: "24:00" })))
      .select("id");
    if (availErr) throw availErr;
    created.crewAvailabilityIds = (avail ?? []).map((r) => r.id);

    const { data: windows } = await db.from("owner_windows").select("id").limit(1);
    if (!windows?.length) {
      const { data: inserted, error } = await db
        .from("owner_windows")
        .insert(([1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) => ({ weekday, start_time: "09:00", end_time: "18:00" })))
        .select("id");
      if (error) throw error;
      created.ownerWindowIds = (inserted ?? []).map((r) => r.id);
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    const del = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await run();
      if (error) console.warn(`[e2e cleanup] ${what}: ${error.message}`);
    };
    const { customerId, leadId, quoteId, jobId } = created;
    const messageIds = customerId
      ? ((await db.from("messages").select("id").eq("customer_id", customerId)).data ?? []).map((m) => m.id)
      : [];
    const itemIds = quoteId ? ((await db.from("quote_items").select("id").eq("quote_id", quoteId)).data ?? []).map((i) => i.id) : [];
    const refs = [quoteId, jobId, ...itemIds, ...messageIds].filter((x): x is string => !!x);
    if (refs.length) await del("approvals", () => db.from("approvals").delete().in("ref_id", refs));
    if (customerId) await del("messages", () => db.from("messages").delete().eq("customer_id", customerId));
    if (jobId) {
      await del("payouts", () => db.from("payouts").delete().eq("job_id", jobId));
      await del("job_assignments", () => db.from("job_assignments").delete().eq("job_id", jobId));
    }
    const keys = [leadId && `quote:${leadId}`, leadId && `custom_summary:${leadId}`, jobId && `reminder:${jobId}`, jobId && `review:${jobId}`];
    await del("fleet_tasks", () => db.from("fleet_tasks").delete().in("dedupe_key", keys.filter((k): k is string => !!k)));
    if (jobId) await del("schedule tasks", () => db.from("fleet_tasks").delete().eq("type", "schedule").contains("payload", { job_ids: [jobId] }));
    if (quoteId) await del("jobs", () => db.from("jobs").delete().eq("quote_id", quoteId));
    if (quoteId) await del("quote_items", () => db.from("quote_items").delete().eq("quote_id", quoteId));
    if (quoteId) await del("quotes", () => db.from("quotes").delete().eq("id", quoteId));
    if (customerId) await del("leads", () => db.from("leads").delete().eq("customer_id", customerId));
    if (customerId) await del("customers", () => db.from("customers").delete().eq("id", customerId));
    if (created.stripeEventIds.length) await del("stripe_events", () => db.from("stripe_events").delete().in("stripe_event_id", created.stripeEventIds));
    if (created.crewAvailabilityIds.length) await del("crew_availability", () => db.from("crew_availability").delete().in("id", created.crewAvailabilityIds));
    if (created.ownerWindowIds.length) await del("owner_windows", () => db.from("owner_windows").delete().in("id", created.ownerWindowIds));
    if (created.crewProfileId) await del("crew profile", () => db.from("profiles").delete().eq("id", created.crewProfileId!));
    if (created.crewUserId) {
      const { error } = await db.auth.admin.deleteUser(created.crewUserId);
      if (error) console.warn(`[e2e cleanup] crew auth user: ${error.message}`);
    }
  });

  // ---------- the flow ----------

  test("form → quote → pay → schedule → crew → book → complete → review card", async ({ page, browser, request }) => {
    test.setTimeout(10 * 60_000);

    const { data: service } = await db
      .from("services")
      .select("*")
      .eq("active", true)
      .eq("auto_quote", true)
      .eq("default_crew_size", 1)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    test.skip(!service, "needs an active, auto-quoted 1-crew service in the services table");

    await test.step("customer submits /quote with a standard service and a custom note", async () => {
      await page.goto(`/quote?service=${service!.slug}`);
      await page.locator('input[name="name"]').fill(CUSTOMER_NAME);
      await page.locator('input[name="phone"]').fill("4405550142");
      await page.locator('input[name="email"]').fill(CUSTOMER_EMAIL);
      await page.locator('input[name="address"]').fill("123 Lake Rd, Rocky River, OH 44116");
      await expect(page.locator(`input[name="services"][value="${service!.slug}"]`)).toBeChecked();
      await page.locator('textarea[name="customRequest"]').fill(CUSTOM_NOTE);
      await page.locator('input[name="emailOptIn"]').check(); // review requests are marketing: opt-in only
      await page.getByRole("button", { name: /quote/i }).last().click();
      await expect(page).toHaveURL(/\/quote\/thanks/, { timeout: 30_000 });
    });

    await test.step("lead lands in the DB; the quote task runs in process", async () => {
      await expect
        .poll(async () => {
          const { data } = await db.from("customers").select("id").eq("email", CUSTOMER_EMAIL).maybeSingle();
          created.customerId = data?.id ?? null;
          if (!data) return null;
          const { data: lead } = await db.from("leads").select("id").eq("customer_id", data.id).maybeSingle();
          created.leadId = lead?.id ?? null;
          return created.leadId;
        }, POLL)
        .not.toBeNull();

      await runTask("quote", `quote:${created.leadId}`, "quotes");
      const { data: quote } = await db.from("quotes").select("*").eq("lead_id", created.leadId!).single();
      created.quoteId = quote!.id;
      expect(quote!.status).toBe("needs_owner");
      const { data: items } = await db.from("quote_items").select("*").eq("quote_id", quote!.id);
      expect(items!.find((i) => !i.is_custom)?.status).toBe("auto");
      expect(items!.find((i) => i.is_custom)?.status).toBe("needs_owner");
    });

    const owner = await newSignedInPage(browser, OWNER_EMAIL!, "/admin");

    await test.step("owner prices the custom item on its card", async () => {
      const c = await card(owner, new RegExp(`Custom request: ${CUSTOMER_NAME}`));
      for (const [label, value] of [["Your price", "120"], ["Hours on site", "2"], ["Crew needed", "1"]] as const) {
        const input = c.getByLabel(label, { exact: true });
        await input.fill(value);
        await input.press("Tab");
      }
      await c.getByRole("button", { name: /add my price to quote/i }).click();
      await expect
        .poll(async () => (await db.from("quote_items").select("status").eq("quote_id", created.quoteId!).eq("is_custom", true).single()).data?.status, POLL)
        .toBe("priced");
      await expect
        .poll(async () => (await db.from("quotes").select("status").eq("id", created.quoteId!).single()).data?.status, POLL)
        .toBe("draft");
    });

    await test.step("owner approves the quote: Stripe test checkout + email with the durable pay link", async () => {
      const c = await card(owner, new RegExp(`Quote for ${CUSTOMER_NAME}`));
      await c.getByRole("button", { name: /approve & send link/i }).click();
      await expect
        .poll(async () => (await db.from("quotes").select("status").eq("id", created.quoteId!).single()).data?.status, POLL)
        .toBe("sent");
      const { data: msg } = await db.from("messages").select("*").eq("quote_id", created.quoteId!).eq("kind", "quote").single();
      expect(msg!.status).toBe("sent");
      expect(msg!.body).toContain(`/quote/pay/${created.quoteId}`);
      // The emailed link mints a Checkout session; we don't complete it in the browser.
      const pay = await request.get(`/quote/pay/${created.quoteId}`, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(pay.status());
      expect(pay.headers()["location"]).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    });

    await test.step("signed checkout.session.completed → quote accepted, paid job", async () => {
      const { data: quote } = await db.from("quotes").select("*").eq("id", created.quoteId!).single();
      const eventId = `evt_e2e_${RUN}`;
      created.stripeEventIds.push(eventId);
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        api_version: Stripe.API_VERSION,
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
        type: "checkout.session.completed",
        data: {
          object: {
            id: quote!.stripe_checkout_id,
            object: "checkout.session",
            mode: "payment",
            status: "complete",
            payment_status: "paid",
            payment_intent: `pi_e2e_${RUN}`,
            client_reference_id: quote!.id,
            amount_total: Math.round(quote!.price_total * 100),
            currency: "usd",
            metadata: { quote_id: quote!.id, customer_id: quote!.customer_id },
          },
        },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET! });
      const res = await request.post("/api/stripe/webhook", {
        data: payload,
        headers: { "content-type": "application/json", "stripe-signature": signature },
      });
      expect(res.status(), await res.text()).toBe(200);

      await expect
        .poll(async () => (await db.from("quotes").select("status").eq("id", created.quoteId!).single()).data?.status, POLL)
        .toBe("accepted");
      const { data: job } = await db.from("jobs").select("*").eq("quote_id", created.quoteId!).single();
      created.jobId = job!.id;
      expect(job).toMatchObject({ status: "unscheduled", paid: true, crew_size: 1 });
      expect((await db.from("leads").select("status").eq("id", created.leadId!).single()).data?.status).toBe("won");
    });

    await test.step("/admin/schedule shows the unscheduled job", async () => {
      await owner.goto("/admin/schedule");
      await expect(owner.getByText(CUSTOMER_NAME).first()).toBeVisible({ timeout: 30_000 });
    });

    await test.step("schedule task (in process) proposes a slot and offers it to the e2e crew member", async () => {
      await dispatch(ctxFor("scheduler"), {
        id: crypto.randomUUID(),
        type: "schedule",
        payload: { reason: "e2e", job_ids: [created.jobId!] },
      });
      const { data: job } = await db.from("jobs").select("*").eq("id", created.jobId!).single();
      expect(job!.status).toBe("proposed");
      expect(job!.schedule_reason).toBeTruthy();
      const { data: offers } = await db.from("job_assignments").select("*").eq("job_id", created.jobId!).eq("status", "offered");
      expect(offers).toHaveLength(1);
      if (offers![0].crew_id !== crewId) {
        // A shared project has other crew; hand the offer to ours so the browser can answer it.
        await db.from("job_assignments").update({ crew_id: crewId }).eq("id", offers![0].id);
      }
    });

    const crewPage = await newSignedInPage(browser, CREW_EMAIL, "/crew");

    await test.step("crew accepts the offer in /crew/offers", async () => {
      await crewPage.goto("/crew/offers");
      await expect(crewPage.getByText(CUSTOMER_NAME).first()).toBeVisible({ timeout: 30_000 });
      await crewPage.getByRole("button", { name: /^accept$/i }).first().click();
      await expect
        .poll(async () => (await db.from("jobs").select("status").eq("id", created.jobId!).single()).data?.status, POLL)
        .toBe("crew_confirmed");
    });

    await test.step("owner books it from the inbox: confirmation sent, reminder queued", async () => {
      const c = await card(owner, new RegExp(`Book ${CUSTOMER_NAME}`));
      await c.getByRole("button", { name: /book & confirm customer/i }).click();
      await expect
        .poll(async () => (await db.from("jobs").select("status").eq("id", created.jobId!).single()).data?.status, POLL)
        .toBe("booked");
      await expect
        .poll(async () => (await db.from("messages").select("status").eq("job_id", created.jobId!).eq("kind", "confirmation").maybeSingle()).data?.status, POLL)
        .toBe("sent");
    });

    await test.step("crew starts and completes the job", async () => {
      // "The day arrives": Start / Complete only show on the job's day, so pull the slot to now.
      const { data: job } = await db.from("jobs").select("*").eq("id", created.jobId!).single();
      const start = new Date(Date.now() - 5 * 60_000);
      await db
        .from("jobs")
        .update({ start_at: start.toISOString(), end_at: new Date(start.getTime() + job!.est_minutes * 60_000).toISOString() })
        .eq("id", created.jobId!);

      await crewPage.goto(`/crew/jobs/${created.jobId}`);
      await crewPage.getByRole("button", { name: /start job/i }).click();
      await expect
        .poll(async () => (await db.from("jobs").select("status").eq("id", created.jobId!).single()).data?.status, POLL)
        .toBe("in_progress");

      await crewPage.reload();
      await crewPage.getByRole("button", { name: /complete job/i }).click();
      const dialog = crewPage.getByRole("dialog");
      const hours = dialog.getByLabel("Hours on site", { exact: true });
      await hours.fill("1.5");
      await hours.press("Tab");
      await dialog.getByRole("button", { name: /mark complete/i }).click();
      await expect
        .poll(async () => (await db.from("jobs").select("status").eq("id", created.jobId!).single()).data?.status, POLL)
        .toBe("done");
      const { data: done } = await db.from("jobs").select("actual_minutes").eq("id", created.jobId!).single();
      expect(done!.actual_minutes).toBe(90);
      const { data: payouts } = await db.from("payouts").select("*").eq("job_id", created.jobId!);
      expect(payouts).toHaveLength(1);
      expect(payouts![0]).toMatchObject({ hours: 1.5 });
    });

    await test.step("review task (in process) drafts the request; the owner sees the review card", async () => {
      await runTask("followup_review", `review:${created.jobId}`, "followup");
      const { data: review } = await db.from("messages").select("*").eq("job_id", created.jobId!).eq("kind", "review").single();
      expect(review!.status).toBe("draft");
      const c = await card(owner, new RegExp(`Review request: ${CUSTOMER_NAME}`));
      await expect(c.getByRole("button", { name: /approve & send/i })).toBeVisible();
    });

    await owner.context().close();
    await crewPage.context().close();
  });
});
