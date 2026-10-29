/**
 * `quote` (role quotes): lead → estimated quote + a job on the "Needs a day" rail.
 *
 * Geocode (if needed) → parcel lookup → estimate hours per requested service → price → write
 * `quotes` + `quote_items` → the job (unscheduled, unpaid: est. minutes + crew from the billed lines)
 * so the owner can drag it onto /admin/schedule, plus a `custom_item` approval per item the owner must
 * price. Nothing is emailed to the customer: the owner calls them once a day is picked (lib/ops/booking.ts).
 * Idempotent per lead: a re-run updates the existing quote in place and never touches items the owner
 * already resolved.
 */
import type { Customer, Quote, QuoteItem, Service, Settings } from "../../lib/db/types";
import { geocode, lookupParcel } from "../../lib/geo";
import { createApproval } from "../../lib/ops/approvals";
import "../../lib/ops/handlers";
import { billableItems, quoteItemInputs } from "../../lib/ops/handlers/custom_item";
import { ensureJobForQuote } from "../../lib/ops/jobs";
import { getSettings } from "../../lib/ops/settings";
import { enqueueTask } from "../../lib/ops/tasks";
import { check, one } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import { DEFAULT_LOT_ACRES, estimateHours, explainPrice, priceItem, priceQuote } from "../../lib/pricing";
import type { TaskContext } from "../context";
import { getById } from "../db";
import { PermanentTaskError } from "../errors";
import { errorMessage } from "../log";
import type { QuotePayload } from "./schemas";

/** Quote statuses a re-run may still rewrite. Anything else (sent, accepted, ...) is left alone. */
const OPEN_STATUSES: ReadonlySet<Quote["status"]> = new Set<Quote["status"]>(["draft", "needs_owner"]);
/** Custom items sort after the standard ones. */
const CUSTOM_SORT = 100;

export type QuoteResult = {
  quote_id: string;
  status: Quote["status"];
  price_total: number;
  items: number;
  custom_items: number;
  /** The job waiting on the schedule's rail (null while nothing on the quote has a price). */
  job_id: string | null;
  skipped?: string;
};

/** Fill in lat/lng (geocoder) and parcel / lot size when missing. Failures are logged, never fatal. */
async function enrichCustomer(ctx: TaskContext, customer: Customer): Promise<Customer> {
  let c = customer;
  if ((c.lat === null || c.lng === null) && c.address) {
    try {
      const hit = await geocode(c.address);
      if (hit) {
        c = one(await ctx.db.from("customers").update({ lat: hit.lat, lng: hit.lng }).eq("id", c.id).select("*").single(), "quote(geocode)");
      }
    } catch (e) {
      ctx.log.warn("geocode failed", { customer: c.id, err: errorMessage(e) });
    }
  }
  if (c.lat !== null && c.lng !== null && c.lot_acres === null) {
    try {
      const parcel = await lookupParcel({ lat: c.lat, lng: c.lng, address: c.address ?? undefined });
      if (parcel && (parcel.lot_acres !== null || parcel.parcel_id)) {
        const patch: Partial<Customer> = {};
        if (parcel.lot_acres !== null) patch.lot_acres = parcel.lot_acres;
        if (parcel.parcel_id && !c.parcel_id) patch.parcel_id = parcel.parcel_id;
        c = one(await ctx.db.from("customers").update(patch).eq("id", c.id).select("*").single(), "quote(parcel)");
      }
    } catch (e) {
      ctx.log.warn("parcel lookup failed", { customer: c.id, err: errorMessage(e) });
    }
  }
  return c;
}

type StandardLine = {
  service: Service;
  crew_size: number;
  est_hours: number;
  price: number | null;
  status: "auto" | "needs_owner";
  why: string;
};

/** One line per requested service, in the order the customer picked them. */
export function standardLines(services: Service[], customer: Pick<Customer, "lot_acres" | "tree_cover">, settings: Settings): StandardLine[] {
  return services.map((service) => {
    const crew_size = Math.max(1, service.default_crew_size);
    const est_hours = estimateHours(service.minutes_rule, customer.lot_acres, customer.tree_cover);
    if (!service.auto_quote) {
      return { service, crew_size, est_hours, price: null, status: "needs_owner", why: `${service.name}: not auto-quoted, needs your price` };
    }
    const { price } = priceItem({ crew_size, est_hours }, settings);
    return { service, crew_size, est_hours, price, status: "auto", why: `${service.name}: ${explainPrice({ crew_size, est_hours }, settings)}` };
  });
}

function rationale(lines: StandardLine[], customer: Customer, settings: Settings, minApplied: boolean, hasCustom: boolean): string {
  const acres =
    customer.lot_acres !== null ? `${customer.lot_acres} acre lot` : `lot size unknown, assumed ${DEFAULT_LOT_ACRES} acre`;
  const cover = customer.tree_cover ? `${customer.tree_cover} tree cover` : "tree cover unknown (none assumed)";
  const out = [`${acres}; ${cover}.`, ...lines.map((l) => `${l.why}.`)];
  if (minApplied && settings.min_job_price !== null) out.push(`Raised to the $${settings.min_job_price} minimum job price.`);
  if (hasCustom) out.push("Includes a custom request that needs your price (not auto-quoted).");
  return out.join("\n");
}

async function loadServices(db: Db, ids: string[]): Promise<Service[]> {
  if (!ids.length) return [];
  const rows = check(await db.from("services").select("*").in("id", ids), "quote(services)") ?? [];
  const byId = new Map(rows.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is Service => !!s && s.active);
}

export async function runQuote(ctx: TaskContext, payload: QuotePayload): Promise<QuoteResult> {
  const { db } = ctx;
  const lead = await getById(db, "leads", payload.lead_id);
  if (!lead) throw new PermanentTaskError(`lead ${payload.lead_id} not found`);
  const found = await getById(db, "customers", lead.customer_id);
  if (!found) throw new PermanentTaskError(`customer ${lead.customer_id} not found`);

  const existing = check(
    await db.from("quotes").select("*").eq("lead_id", lead.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "quote(existing)",
  );
  if (existing && !OPEN_STATUSES.has(existing.status)) {
    return {
      quote_id: existing.id, status: existing.status, price_total: existing.price_total, items: 0, custom_items: 0,
      job_id: null, skipped: `quote already ${existing.status}`,
    };
  }

  const customer = await enrichCustomer(ctx, found);
  const settings = await getSettings(db);
  const services = await loadServices(db, lead.requested_service_ids ?? []);
  const lines = standardLines(services, customer, settings);
  const customText = lead.custom_request?.trim() ?? "";
  const photos = lead.photo_paths ?? [];
  const wantsCustom = customText.length > 0 || photos.length > 0;

  // ---- quote row ----
  const base = { lead_id: lead.id, customer_id: customer.id, margin: settings.margin, wage: settings.default_wage };
  const quote: Quote = existing
    ? one(await db.from("quotes").update(base).eq("id", existing.id).select("*").single(), "quote(update)")
    : one(
        await db
          .from("quotes")
          .insert({ ...base, status: "draft", price_total: 0, labor_total: 0, fee_total: 0, profit_total: 0 })
          .select("*")
          .single(),
        "quote(insert)",
      );

  // ---- items ----
  const current = existing
    ? check(await db.from("quote_items").select("*").eq("quote_id", quote.id), "quote(items)") ?? []
    : [];
  const wanted = new Set(lines.map((l) => l.service.id));
  for (const old of current) {
    // Drop machine-made lines for services no longer requested; never drop what the owner resolved.
    if (!old.is_custom && old.service_id && !wanted.has(old.service_id) && (old.status === "auto" || old.status === "needs_owner")) {
      check(await db.from("quote_items").delete().eq("id", old.id), "quote(drop item)");
    }
  }
  const ownerItems: QuoteItem[] = []; // standard items the owner must price (auto_quote = false)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = current.find((c) => !c.is_custom && c.service_id === l.service.id);
    const fields = {
      quote_id: quote.id, service_id: l.service.id, description: l.service.name, is_custom: false,
      crew_size: l.crew_size, est_hours: l.est_hours, price: l.price, status: l.status, sort_order: i,
    };
    if (prev && prev.status !== "auto" && prev.status !== "needs_owner") continue; // owner already decided
    const row = prev
      ? one(await db.from("quote_items").update(fields).eq("id", prev.id).select("*").single(), "quote(update item)")
      : one(await db.from("quote_items").insert({ ...fields, partner_note: null, ai_summary: null }).select("*").single(), "quote(insert item)");
    if (row.status === "needs_owner") ownerItems.push(row);
  }

  let customItem = current.find((c) => c.is_custom) ?? null;
  if (wantsCustom && !customItem) {
    customItem = one(
      await db
        .from("quote_items")
        .insert({
          quote_id: quote.id, service_id: null, description: customText || "Customer sent photos (no note)", is_custom: true,
          crew_size: 1, est_hours: 0, price: null, status: "needs_owner", partner_note: null, ai_summary: null, sort_order: CUSTOM_SORT,
        })
        .select("*")
        .single(),
      "quote(custom item)",
    );
  }
  if (customItem && customItem.status === "needs_owner") {
    ownerItems.push(customItem);
    if (!customItem.ai_summary) {
      await enqueueTask(db, { type: "custom_summary", payload: { lead_id: lead.id }, dedupeKey: `custom_summary:${lead.id}` });
    }
  }

  // ---- totals ----
  const items = check(await db.from("quote_items").select("*").eq("quote_id", quote.id), "quote(items after)") ?? [];
  const totals = priceQuote(quoteItemInputs(items), settings);
  const status: Quote["status"] = totals.needs_owner ? "needs_owner" : "draft";
  const saved = one(
    await db
      .from("quotes")
      .update({
        status,
        price_total: totals.price_total,
        labor_total: totals.labor_total,
        fee_total: totals.fee_total,
        profit_total: totals.profit_total,
        rationale: rationale(lines, customer, settings, totals.min_applied, ownerItems.some((i) => i.is_custom)),
      })
      .eq("id", quote.id)
      .select("*")
      .single(),
    "quote(totals)",
  );

  // ---- approvals ----
  for (const item of ownerItems) {
    await createApproval(db, {
      kind: "custom_item",
      ref_table: "quote_items",
      ref_id: item.id,
      payload: { quote_item_id: item.id, quote_id: saved.id },
      title: item.is_custom ? `Custom request: ${customer.name}` : `Price needed: ${item.description} for ${customer.name}`,
      summary: item.description,
      created_by: ctx.worker,
    });
  }

  // ---- the job ----
  // As soon as something on the quote has a price the job exists (unscheduled, unpaid) and shows on the
  // schedule's "Needs a day" rail. Custom lines the owner prices later refresh its estimate.
  const job = billableItems(items).length > 0 ? await ensureJobForQuote(db, saved.id) : null;

  check(await db.from("leads").update({ status: "quoted" }).eq("id", lead.id), "quote(lead status)");
  return {
    quote_id: saved.id, status, price_total: saved.price_total, items: items.length,
    custom_items: ownerItems.length, job_id: job?.id ?? null,
  };
}
