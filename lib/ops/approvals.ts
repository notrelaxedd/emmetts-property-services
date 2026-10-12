import type { Approval, ApprovalKind, ApprovalStatus, Settings } from "../db/types";
import { getSettings } from "./settings";
import { check, one } from "./types";
import type { Db } from "./types";

export type CreateApprovalInput = {
  kind: ApprovalKind;
  ref_table: string;
  ref_id: string;
  payload: Record<string, unknown>;
  title: string;
  summary?: string | null;
  /** Worker name or user. */
  created_by: string;
};

/**
 * Inserts a `pending` approval. If a pending approval with the same kind + ref_table + ref_id
 * already exists it is refreshed (payload / title / summary) and returned instead of duplicating.
 */
export async function createApproval(db: Db, input: CreateApprovalInput): Promise<Approval> {
  const existing = check(
    await db
      .from("approvals")
      .select("*")
      .eq("kind", input.kind)
      .eq("ref_table", input.ref_table)
      .eq("ref_id", input.ref_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    "createApproval(lookup)",
  );
  if (existing) {
    return one(
      await db
        .from("approvals")
        .update({ payload: input.payload, title: input.title, summary: input.summary ?? null })
        .eq("id", existing.id)
        .select("*")
        .single(),
      "createApproval(refresh)",
    );
  }
  return one(
    await db
      .from("approvals")
      .insert({
        kind: input.kind,
        ref_table: input.ref_table,
        ref_id: input.ref_id,
        payload: input.payload,
        title: input.title,
        summary: input.summary ?? null,
        created_by: input.created_by,
        status: "pending",
        decided_at: null,
        decided_by: null,
        decision_note: null,
      })
      .select("*")
      .single(),
    "createApproval(insert)",
  );
}

/**
 * True only when the owner has switched autopilot on for this kind. Quotes additionally need
 * `payload.price_total <= max_total` (`max_total = null` means any total). Kinds without a rule
 * (e.g. `ai_cap`) are never autopiloted.
 */
export function isAutopiloted(
  kind: ApprovalKind,
  payload: Record<string, unknown>,
  settings: Pick<Settings, "autopilot">,
): boolean {
  const rules = settings.autopilot as unknown as Record<string, { enabled?: boolean; max_total?: number | null } | undefined>;
  const rule = rules?.[kind];
  if (!rule || rule.enabled !== true) return false;
  if (kind === "quote") {
    const max = rule.max_total ?? null;
    if (max === null) return true;
    const total = payload.price_total;
    return typeof total === "number" && Number.isFinite(total) && total <= max;
  }
  return true;
}

export type RequestApprovalResult = { approval: Approval; autoApproved: boolean };

/**
 * createApproval, then, if autopilot covers it, immediately mark it `approved` by `autopilot`.
 * When `autoApproved` is true the caller must run the side effect (e.g. via `applyApproval`).
 */
export async function requestApproval(
  db: Db,
  input: CreateApprovalInput,
  settings?: Pick<Settings, "autopilot">,
): Promise<RequestApprovalResult> {
  const approval = await createApproval(db, input);
  const s = settings ?? (await getSettings(db));
  if (!isAutopiloted(input.kind, input.payload, s)) return { approval, autoApproved: false };
  const approved = one(
    await db
      .from("approvals")
      .update({ status: "approved", decided_by: "autopilot", decided_at: new Date().toISOString() })
      .eq("id", approval.id)
      .eq("status", "pending")
      .select("*")
      .single(),
    "requestApproval(auto-approve)",
  );
  return { approval: approved, autoApproved: true };
}

export type ApprovalDecision = "approved" | "edited" | "rejected";

/**
 * Records the owner's decision on a pending approval. `payloadPatch` is shallow-merged into the
 * payload (use it for edits). Throws if the approval is missing or already decided.
 * Side effects are NOT run here; call `applyApproval` afterwards.
 */
export async function decideApproval(
  db: Db,
  id: string,
  decision: ApprovalDecision,
  opts: { decidedBy: string; note?: string | null; payloadPatch?: Record<string, unknown> },
): Promise<Approval> {
  const current = check(await db.from("approvals").select("*").eq("id", id).maybeSingle(), "decideApproval(lookup)");
  if (!current) throw new Error(`decideApproval: approval ${id} not found`);
  if (current.status !== "pending") {
    throw new Error(`decideApproval: approval ${id} is already ${current.status}`);
  }
  const update: Partial<Approval> = {
    status: decision as ApprovalStatus,
    decided_by: opts.decidedBy,
    decided_at: new Date().toISOString(),
  };
  if (opts.note !== undefined) update.decision_note = opts.note;
  if (opts.payloadPatch) update.payload = { ...current.payload, ...opts.payloadPatch };
  return one(
    await db.from("approvals").update(update).eq("id", id).eq("status", "pending").select("*").single(),
    "decideApproval(update)",
  );
}

// ---------- Side-effect handler registry ----------

export type ApprovalContext = { siteUrl: string; actor: string };
export type ApprovalHandler = (db: Db, approval: Approval, ctx: ApprovalContext) => Promise<void> | void;

const handlers = new Map<ApprovalKind, ApprovalHandler>();

/** Registers (or replaces) the side-effect handler for an approval kind. */
export function registerApprovalHandler(kind: ApprovalKind, fn: ApprovalHandler): void {
  handlers.set(kind, fn);
}

/** Test helper: forget every registered handler. */
export function clearApprovalHandlers(): void {
  handlers.clear();
}

/**
 * Runs the handler for `approval.kind` when the approval is `approved` / `edited`.
 * Returns true if a handler ran. Pending / rejected approvals are a no-op; an unknown kind
 * warns and is a no-op.
 */
export async function applyApproval(db: Db, approval: Approval, ctx: ApprovalContext): Promise<boolean> {
  if (approval.status !== "approved" && approval.status !== "edited") return false;
  const fn = handlers.get(approval.kind);
  if (!fn) {
    console.warn(`applyApproval: no handler registered for approval kind "${approval.kind}" (id ${approval.id})`);
    return false;
  }
  await fn(db, approval, ctx);
  return true;
}

const ALL_KINDS: ApprovalKind[] = [
  "ad",
  "quote",
  "custom_item",
  "booking",
  "followup",
  "crew_change",
  "drop",
  "weather_hold",
  "ai_cap",
];

/** Pending approval counts, zero-filled for every kind. */
export async function pendingCounts(db: Db): Promise<Record<ApprovalKind, number>> {
  const rows = check(await db.from("approvals").select("kind").eq("status", "pending"), "pendingCounts");
  const counts = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<ApprovalKind, number>;
  for (const r of rows ?? []) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return counts;
}
