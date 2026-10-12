/**
 * AI spend guardrails: usage logging, monthly spend, cap enforcement, and the approval card raised
 * when the cap is hit. Takes a service-role Supabase client; no framework imports.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_ID, type Database } from "../db/types";
import { estimateCost, type TokenUsage } from "./pricing";

type Db = SupabaseClient<Database>;

export class AiCapExceededError extends Error {
  readonly spend: number;
  readonly cap: number;
  constructor(spend: number, cap: number) {
    super(`AI monthly cap reached: spent $${spend.toFixed(2)} of $${cap.toFixed(2)} this month.`);
    this.name = "AiCapExceededError";
    this.spend = spend;
    this.cap = cap;
  }
}

function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Month-to-date spend in USD. Uses rpc `ai_spend_this_month`; falls back to summing `ai_usage.est_cost`. */
export async function getAiSpendThisMonth(db: Db): Promise<number> {
  const rpc = await db.rpc("ai_spend_this_month");
  if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
    const n = Number(rpc.data);
    if (Number.isFinite(n)) return n;
  }
  const { data, error } = await db.from("ai_usage").select("est_cost").gte("created_at", startOfMonthIso());
  if (error) throw new Error(`Could not read AI spend: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + Number((row as { est_cost: number }).est_cost ?? 0), 0);
}

/** The monthly cap in USD, or null when there is none. */
export async function getAiMonthlyCap(db: Db): Promise<number | null> {
  const { data, error } = await db.from("settings").select("ai_monthly_cap").eq("id", SETTINGS_ID).maybeSingle();
  if (error) throw new Error(`Could not read AI cap: ${error.message}`);
  const cap = (data as { ai_monthly_cap: number | null } | null)?.ai_monthly_cap;
  return cap === null || cap === undefined ? null : Number(cap);
}

/** Throws AiCapExceededError when this month's spend has reached `settings.ai_monthly_cap` (null = no cap). */
export async function assertUnderCap(db: Db): Promise<void> {
  const cap = await getAiMonthlyCap(db);
  if (cap === null) return;
  const spend = await getAiSpendThisMonth(db);
  if (spend >= cap) throw new AiCapExceededError(spend, cap);
}

export type LogUsageInput = {
  task: string;
  model: string;
  usage: TokenUsage;
  worker?: string | null;
};

/**
 * Insert one `ai_usage` row. Never throws: a logging failure must not lose a draft we already paid for.
 * Unknown models are priced at the Sonnet rate and `priceKnown` comes back false (and a warning is logged).
 */
export async function logUsage(
  db: Db,
  input: LogUsageInput,
): Promise<{ est_cost: number; priceKnown: boolean; logged: boolean }> {
  const cost = estimateCost(input.model, input.usage);
  if (!cost.known) {
    console.warn(`[ai] no price for model "${input.model}"; costed at ${cost.matched} rates (flagged).`);
  }
  const row = {
    task: input.task,
    model: input.model,
    input_tokens: input.usage.input_tokens ?? 0,
    output_tokens: input.usage.output_tokens ?? 0,
    cache_read_tokens: input.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: input.usage.cache_creation_input_tokens ?? 0,
    est_cost: cost.est_cost,
    worker: input.worker ?? null,
  };
  try {
    const { error } = await db.from("ai_usage").insert(row);
    if (error) {
      console.error(`[ai] failed to log usage: ${error.message}`);
      return { est_cost: cost.est_cost, priceKnown: cost.known, logged: false };
    }
    return { est_cost: cost.est_cost, priceKnown: cost.known, logged: true };
  } catch (err) {
    console.error("[ai] failed to log usage:", err);
    return { est_cost: cost.est_cost, priceKnown: cost.known, logged: false };
  }
}

/**
 * Raise the "AI monthly cap reached" approval card, once. Skips when a pending `ai_cap` approval exists.
 * Safe to call from every helper that hits the cap. Returns whether a new row was created.
 */
export async function raiseAiCapApproval(
  db: Db,
  task: string,
  opts: { worker?: string | null; spend?: number; cap?: number } = {},
): Promise<{ created: boolean }> {
  const existing = await db.from("approvals").select("id").eq("kind", "ai_cap").eq("status", "pending").limit(1);
  if (existing.error) throw new Error(`Could not check for an existing AI cap approval: ${existing.error.message}`);
  if ((existing.data ?? []).length > 0) return { created: false };

  const money = (n: number | undefined) => (n === undefined ? "the monthly cap" : `$${n.toFixed(2)}`);
  const summary =
    `The AI task "${task}" was skipped because this month's AI spend (${money(opts.spend)}) has reached the cap ` +
    `(${money(opts.cap)}). No new drafts will be written until you raise the cap in Settings or next month starts.`;
  const { error } = await db.from("approvals").insert({
    kind: "ai_cap",
    ref_table: "settings",
    ref_id: SETTINGS_ID,
    title: "AI monthly cap reached",
    summary,
    payload: { task, spend: opts.spend ?? null, cap: opts.cap ?? null },
    status: "pending",
    created_by: opts.worker ?? "ai",
  });
  if (error) {
    // 23505: a concurrent caller inserted the pending card first; that is the outcome we wanted.
    if ((error as { code?: string }).code === "23505") return { created: false };
    throw new Error(`Could not raise AI cap approval: ${error.message}`);
  }
  return { created: true };
}
