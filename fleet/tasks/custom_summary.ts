/**
 * `custom_summary` (role quotes): Claude reads the customer's note + photos and writes an owner-only
 * summary with a suggested crew / hours / price range onto the custom quote item. Also estimates
 * tree cover from the photos and fills `customers.tree_cover` when confident and still unknown.
 * Nothing here reaches the customer.
 */
import { AiCapExceededError } from "../../lib/ai/claude";
import type { QuoteItem } from "../../lib/db/types";
import { createApproval } from "../../lib/ops/approvals";
import { getSettings } from "../../lib/ops/settings";
import { enqueueTask } from "../../lib/ops/tasks";
import { check, one } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import type { TaskContext } from "../context";
import { getById } from "../db";
import { PermanentTaskError } from "../errors";
import { errorMessage } from "../log";
import type { CustomSummaryPayload } from "./schemas";

export const PHOTO_BUCKET = "lead-photos";
export const SIGNED_URL_SECONDS = 600;
export const TREE_COVER_MIN_CONFIDENCE = 0.6;

/** Short-lived signed URLs for the private lead photos; unreadable paths are skipped. */
export async function signedPhotoUrls(ctx: TaskContext, paths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const path of paths) {
    try {
      const { data, error } = await ctx.db.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "no signed url");
      urls.push(data.signedUrl);
    } catch (e) {
      ctx.log.warn("photo url failed", { path, err: errorMessage(e) });
    }
  }
  return urls;
}

async function findOrCreateCustomItem(db: Db, quoteId: string, description: string): Promise<QuoteItem> {
  const existing = check(
    await db.from("quote_items").select("*").eq("quote_id", quoteId).eq("is_custom", true).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "custom_summary(item)",
  );
  if (existing) return existing;
  return one(
    await db
      .from("quote_items")
      .insert({
        quote_id: quoteId, service_id: null, description, is_custom: true, crew_size: 1, est_hours: 0, price: null,
        status: "needs_owner", partner_note: null, ai_summary: null, sort_order: 100,
      })
      .select("*")
      .single(),
    "custom_summary(create item)",
  );
}

export async function runCustomSummary(ctx: TaskContext, payload: CustomSummaryPayload): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const lead = await getById(db, "leads", payload.lead_id);
  if (!lead) throw new PermanentTaskError(`lead ${payload.lead_id} not found`);
  const note = lead.custom_request?.trim() ?? "";
  const paths = lead.photo_paths ?? [];
  if (!note && paths.length === 0) return { skipped: "nothing to summarize" };

  const customer = await getById(db, "customers", lead.customer_id);
  if (!customer) throw new PermanentTaskError(`customer ${lead.customer_id} not found`);
  const quote = check(
    await db.from("quotes").select("*").eq("lead_id", lead.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "custom_summary(quote)",
  );
  // The quote task enqueues us after writing the quote; if it is not there yet, retry later.
  if (!quote) throw new Error(`no quote yet for lead ${lead.id}`);

  const settings = await getSettings(db);
  const urls = await signedPhotoUrls(ctx, paths);
  const result: Record<string, unknown> = { quote_id: quote.id, photos: urls.length };

  try {
    const s = await ctx.ai.summarizeCustomRequest(db, {
      note: note || "(No note. The customer only sent photos.)",
      photoUrls: urls,
      lotAcres: customer.lot_acres,
      wage: settings.default_wage,
      margin: settings.margin,
    });
    const summary = s.risks.length ? `${s.summary}\nWatch out for: ${s.risks.join("; ")}` : s.summary;
    const item = await findOrCreateCustomItem(db, quote.id, note || "Customer sent photos (no note)");
    const ai_summary = {
      summary, crew_size: s.crew_size, hours_min: s.hours_min, hours_max: s.hours_max, price_min: s.price_min, price_max: s.price_max,
    };
    check(await db.from("quote_items").update({ ai_summary }).eq("id", item.id), "custom_summary(write)");
    if (item.status === "needs_owner") {
      // Refresh the inbox card's summary line (createApproval refreshes a pending card in place).
      await createApproval(db, {
        kind: "custom_item",
        ref_table: "quote_items",
        ref_id: item.id,
        payload: { quote_item_id: item.id, quote_id: quote.id },
        title: `Custom request: ${customer.name}`,
        summary: `${s.summary} Suggested: ${s.crew_size} crew, ${s.hours_min}–${s.hours_max} h, $${s.price_min}–$${s.price_max}.`,
        created_by: ctx.worker,
      });
    }
    result.quote_item_id = item.id;
    result.summary = true;
  } catch (e) {
    if (e instanceof AiCapExceededError) return { ...result, skipped: "ai_cap" };
    throw e;
  }

  if (urls.length > 0) {
    try {
      const est = await ctx.ai.estimateFromPhotos(db, { photoUrls: urls, lotAcres: customer.lot_acres });
      result.tree_cover = est.tree_cover;
      result.tree_cover_confidence = est.confidence;
      if (est.confidence >= TREE_COVER_MIN_CONFIDENCE && customer.tree_cover === null) {
        check(await db.from("customers").update({ tree_cover: est.tree_cover }).eq("id", customer.id), "custom_summary(tree cover)");
        result.tree_cover_set = true;
        // Standard items depend on tree cover: re-price the quote if it has not gone out yet.
        if (quote.status === "draft" || quote.status === "needs_owner") {
          await enqueueTask(db, { type: "quote", payload: { lead_id: lead.id }, dedupeKey: `quote:${lead.id}:tree_cover` });
        }
      }
    } catch (e) {
      if (e instanceof AiCapExceededError) return { ...result, skipped: "ai_cap" };
      ctx.log.warn("tree cover estimate failed", { lead: lead.id, err: errorMessage(e) });
    }
  }
  return result;
}
