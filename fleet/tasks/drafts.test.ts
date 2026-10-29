import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCapExceededError } from "../../lib/ai/claude";
import { registerApprovalHandler } from "../../lib/ops/approvals";
import { customerRow, jobRow, settingsRow } from "../../lib/ops/test-utils";
import { fakeAi, fleetDb, makeCtx } from "../test-helpers";
import { runAdDraft } from "./ad_draft";
import { payloadSchemas } from "./schemas";
import { PermanentTaskError } from "../errors";
import { MAX_DEFERS, runCustomSummary } from "./custom_summary";
import { runFollowupReminder } from "./followup_reminder";
import { runFollowupReview } from "./followup_review";

const T0 = "2026-01-01T00:00:00.000Z";
const NOW = new Date("2026-10-12T14:00:00.000Z");

describe("custom_summary", () => {
  function seed(customer = {}) {
    return fleetDb({
      settings: [settingsRow()],
      customers: [customerRow({ id: "c1", name: "Pat Smith", lot_acres: 0.3, ...customer })],
      leads: [{ id: "l1", customer_id: "c1", custom_request: "Dead maple by the garage", photo_paths: ["l1/a.jpg", "l1/b.jpg"] } as never],
      quotes: [{ id: "q1", lead_id: "l1", customer_id: "c1", status: "needs_owner", created_at: T0 } as never],
      quote_items: [{ id: "i1", quote_id: "q1", is_custom: true, status: "needs_owner", description: "Dead maple by the garage", created_at: T0 } as never],
      approvals: [{ id: "ap1", kind: "custom_item", ref_table: "quote_items", ref_id: "i1", status: "pending", payload: {}, title: "Custom request: Pat Smith", created_at: T0 } as never],
    });
  }

  it("writes the owner-only summary, sets tree cover when confident, and re-prices", async () => {
    const db = seed();
    const ai = fakeAi();
    const res = await runCustomSummary(makeCtx(db, { ai }), { lead_id: "l1" });
    expect(db.signedUrls).toEqual(["https://signed.test/lead-photos/l1/a.jpg?ttl=600", "https://signed.test/lead-photos/l1/b.jpg?ttl=600"]);
    expect(ai.summarizeCustomRequest.mock.calls[0][1]).toMatchObject({ note: "Dead maple by the garage", photoUrls: db.signedUrls, lotAcres: 0.3, wage: 15, margin: 0.5 });
    expect(db.tables.quote_items[0].ai_summary).toEqual({
      summary: "Remove one dead maple near the garage.\nWatch out for: near power line", crew_size: 3, hours_min: 4, hours_max: 6, price_min: 600, price_max: 900,
    });
    expect(db.tables.approvals[0].summary).toMatch(/Suggested: 3 crew, 4–6 h, \$600–\$900/);
    expect(db.tables.customers[0].tree_cover).toBe("heavy");
    expect(db.tables.fleet_tasks[0]).toMatchObject({ type: "quote", dedupe_key: "quote:l1:tree_cover" });
    expect(res).toMatchObject({ summary: true, tree_cover_set: true });
  });

  it("keeps an existing tree cover and ignores low-confidence guesses", async () => {
    const db = seed({ tree_cover: "light" });
    await runCustomSummary(makeCtx(db), { lead_id: "l1" });
    expect(db.tables.customers[0].tree_cover).toBe("light");
    const db2 = seed();
    await runCustomSummary(makeCtx(db2, { ai: fakeAi({ estimateFromPhotos: vi.fn(async () => ({ tree_cover: "heavy" as const, confidence: 0.4, notes: "" })) }) }), { lead_id: "l1" });
    expect(db2.tables.customers[0].tree_cover).toBeNull();
  });

  it("completes with skipped: ai_cap when the cap is hit", async () => {
    const db = seed();
    const ai = fakeAi({ summarizeCustomRequest: vi.fn(async () => { throw new AiCapExceededError(51, 50); }) });
    expect(await runCustomSummary(makeCtx(db, { ai }), { lead_id: "l1" })).toMatchObject({ skipped: "ai_cap" });
    expect(db.tables.quote_items[0].ai_summary ?? null).toBeNull();
  });

  it("defers (without burning attempts) while the quote does not exist yet, then gives up permanently", async () => {
    const db = seed();
    db.tables.quotes.length = 0;
    const ctx = makeCtx(db, { now: () => NOW });
    const res = await runCustomSummary(ctx, { lead_id: "l1" });
    expect(res).toMatchObject({ deferred: true, defer: 1 });
    expect(db.tables.fleet_tasks).toHaveLength(1);
    expect(db.tables.fleet_tasks[0]).toMatchObject({
      type: "custom_summary", payload: { lead_id: "l1", defer: 1 }, dedupe_key: "custom_summary:l1:defer:1",
      run_after: new Date(NOW.getTime() + 2 * 60_000).toISOString(),
    });
    // A re-run of the same task (e.g. after a crash) enqueues the same next hop, not a new one.
    await runCustomSummary(ctx, { lead_id: "l1" });
    expect(db.tables.fleet_tasks).toHaveLength(1);
    // The next hop chains on with a new key.
    await runCustomSummary(ctx, { lead_id: "l1", defer: 1 });
    expect(db.tables.fleet_tasks.map((t) => t.dedupe_key)).toEqual(["custom_summary:l1:defer:1", "custom_summary:l1:defer:2"]);
    expect(ctx.ai.summarizeCustomRequest).not.toHaveBeenCalled();
    await expect(runCustomSummary(ctx, { lead_id: "l1", defer: MAX_DEFERS })).rejects.toBeInstanceOf(PermanentTaskError);
    // Once the quote exists the deferred task does the work.
    db.tables.quotes.push({ id: "q1", lead_id: "l1", customer_id: "c1", status: "needs_owner", created_at: T0 } as never);
    expect(await runCustomSummary(ctx, { lead_id: "l1", defer: 2 })).toMatchObject({ summary: true });
  });
});

describe("ad_draft", () => {
  it("drafts an ad with a utm code and raises an ad approval", async () => {
    const db = fleetDb({ settings: [settingsRow()] });
    const ctx = makeCtx(db, { role: "ads", worker: "W1", now: () => NOW });
    const res = await runAdDraft(ctx, { channel: "nextdoor", season: "fall", offer: "Fall lawn cleanup" });
    expect(db.tables.ads[0]).toMatchObject({ channel: "nextdoor", status: "draft", utm_code: "nextdoor-fall-20261012", headline: "Fall leaf cleanup in Rocky River", cta: "Get a quote" });
    expect(db.tables.approvals[0]).toMatchObject({
      kind: "ad", ref_table: "ads", ref_id: db.tables.ads[0].id, title: "nextdoor ad: Fall leaf cleanup in Rocky River", created_by: "W1",
      payload: { ad_id: db.tables.ads[0].id, channel: "nextdoor", headline: "Fall leaf cleanup in Rocky River", body: "We rake, blow and haul.", cta: "Get a quote" },
    });
    // A retry reuses the draft row (utm codes are unique); an approved ad's code gets a suffix.
    await runAdDraft(ctx, { channel: "nextdoor", season: "fall", offer: "Fall lawn cleanup" });
    expect(db.tables.ads).toHaveLength(1);
    db.tables.ads[0].status = "approved";
    await runAdDraft(ctx, { channel: "nextdoor", season: "fall", offer: "Fall lawn cleanup" });
    expect(db.tables.ads.map((a) => a.utm_code)).toEqual(["nextdoor-fall-20261012", "nextdoor-fall-20261012-2"]);
    expect(res.ad_id).toBeTruthy();
  });

  it("a blank offer (the admin form's optional field) leads with the site's current headline and still validates", async () => {
    expect(payloadSchemas.ad_draft.safeParse({ channel: "facebook", season: "fall", offer: "" }).success).toBe(true);
    expect(payloadSchemas.ad_draft.safeParse({ channel: "facebook", season: "fall" }).success).toBe(true);
    const db = fleetDb({ settings: [settingsRow()] });
    const ai = fakeAi();
    await runAdDraft(makeCtx(db, { ai, role: "ads", worker: "W1", now: () => NOW }), { channel: "facebook", season: "fall", offer: "" });
    expect(ai.draftAd.mock.calls[0][1]).toMatchObject({ channel: "facebook", season: "fall", offer: "Fall lawn cleanup" });
    expect(db.tables.ads[0]).toMatchObject({ offer: "Fall lawn cleanup" });
    expect(String(db.tables.approvals[0].summary)).toContain("fall · Fall lawn cleanup");
  });

  it("autopilot marks the ad approved via the ad handler; the cap skips", async () => {
    const db = fleetDb({ settings: [settingsRow({ autopilot: { ...settingsRow().autopilot, ad: { enabled: true } } })] });
    await runAdDraft(makeCtx(db, { now: () => NOW }), { channel: "facebook", season: "fall", offer: "x" });
    expect(db.tables.ads[0].status).toBe("approved");
    const capped = fakeAi({ draftAd: vi.fn(async () => { throw new AiCapExceededError(1, 1); }) });
    expect(await runAdDraft(makeCtx(fleetDb({ settings: [settingsRow()] }), { ai: capped }), { channel: "facebook", season: "fall", offer: "x" })).toEqual({ skipped: "ai_cap" });
  });
});

describe("follow-ups", () => {
  function seed(job = {}, customer = {}) {
    return fleetDb({
      settings: [settingsRow()],
      customers: [customerRow({ id: "c1", name: "Pat Smith", email: "pat@x.test", email_opt_in: true, address: "1 Lake Rd", ...customer })],
      jobs: [jobRow({ id: "j1", customer_id: "c1", quote_id: "q1", status: "done", start_at: "2026-10-13T13:00:00.000Z", end_at: "2026-10-13T14:30:00.000Z", ...job })],
      quote_items: [
        { id: "i1", quote_id: "q1", description: "Leaf cleanup", status: "auto", sort_order: 0 } as never,
        { id: "i2", quote_id: "q1", description: "Tree", status: "referred", sort_order: 1 } as never,
      ],
    });
  }
  beforeEach(() => vi.restoreAllMocks());

  it("review: drafts for a done job with opt-in and raises a followup approval", async () => {
    const db = seed();
    const ai = fakeAi();
    const res = await runFollowupReview(makeCtx(db, { ai, role: "followup" }), { job_id: "j1" });
    expect(ai.draftMessage.mock.calls[0][1]).toMatchObject({ kind: "review", job: { services: ["Leaf cleanup"] } });
    expect(db.tables.messages[0]).toMatchObject({ kind: "review", status: "draft", channel: "email", job_id: "j1", subject: "AI review" });
    expect(db.tables.approvals[0]).toMatchObject({
      kind: "followup", ref_table: "messages", title: "Review request: Pat Smith",
      payload: { message_id: db.tables.messages[0].id, kind: "review", subject: "AI review", body: "AI body for review", job_id: "j1" },
    });
    expect(res.auto_sent).toBe(false);
    // Re-run while still a draft: rewrites the same message and card.
    await runFollowupReview(makeCtx(db, { role: "followup" }), { job_id: "j1" });
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.approvals).toHaveLength(1);
  });

  it("review: skips without opt-in, or when the job is not done", async () => {
    expect(await runFollowupReview(makeCtx(seed({}, { email_opt_in: false })), { job_id: "j1" })).toEqual({ skipped: "customer not opted in to email" });
    expect(await runFollowupReview(makeCtx(seed({ status: "booked" })), { job_id: "j1" })).toEqual({ skipped: "job is booked" });
  });

  it("reminder: transactional (no opt-in needed), template fallback, autopilot sends via the followup handler", async () => {
    const db = seed({ status: "booked" }, { email_opt_in: false });
    db.tables.settings[0].autopilot = { ...settingsRow().autopilot, followup: { enabled: true } };
    const send = vi.fn();
    registerApprovalHandler("followup", send);
    const ai = fakeAi({ draftMessage: vi.fn(async () => { throw new Error("boom"); }) });
    const res = await runFollowupReminder(makeCtx(db, { ai, now: () => NOW }), { job_id: "j1" });
    expect(db.tables.messages[0]).toMatchObject({ kind: "reminder", channel: "email" });
    expect(String(db.tables.messages[0].body)).toMatch(/on Tue Oct 13, 9:00–10:30am/);
    expect(db.tables.approvals[0]).toMatchObject({ status: "approved", decided_by: "autopilot" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ auto_sent: true, draft: "template" });
  });

  it("reminder: texts only with sms opt-in", async () => {
    const db = seed({ status: "booked" }, { email: null, phone: "4405550100", sms_opt_in: true });
    await runFollowupReminder(makeCtx(db, { now: () => NOW }), { job_id: "j1" });
    expect(db.tables.messages[0]).toMatchObject({ channel: "sms", subject: null });
    const none = seed({ status: "booked" }, { email: null, phone: "4405550100", sms_opt_in: false });
    expect(await runFollowupReminder(makeCtx(none, { now: () => NOW }), { job_id: "j1" })).toEqual({ skipped: "no email and no SMS opt-in" });
  });
});
