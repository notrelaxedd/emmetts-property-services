import "server-only"

// Registers the per-kind side effects; must run before any `applyApproval`.
import "@/lib/ops/handlers"

import type { Session } from "@/lib/auth/session"
import type { Approval } from "@/lib/db/types"
import { applyApproval } from "@/lib/ops/approvals"
import type { Db } from "@/lib/ops/types"

/** Public site origin used in emails / Stripe redirect URLs (same rule as the Stripe webhook route). */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  return raw.replace(/\/$/, "")
}

/** Who to record as the decider / actor. */
export function actorOf(session: Session): string {
  return session.email ?? "owner"
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === "string" ? e : "Something went wrong"
}

/** Prefix used on `decision_note` lines written when a side effect throws. */
export const FAILURE_PREFIX = "[side effect failed]"

function withoutFailures(note: string | null): string {
  return (note ?? "")
    .split("\n")
    .filter((l) => !l.startsWith(FAILURE_PREFIX))
    .join("\n")
    .trim()
}

/**
 * Runs the approval's side effect. On error the decision is KEPT and the error is appended to
 * `decision_note` (so it shows in the Decided list with a Retry button); the message is returned.
 * On success any earlier failure lines are cleared.
 */
export async function runApprovalSideEffect(
  db: Db,
  approval: Approval,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await applyApproval(db, approval, { siteUrl: siteUrl(), actor })
    if (approval.decision_note?.includes(FAILURE_PREFIX)) {
      await db.from("approvals").update({ decision_note: withoutFailures(approval.decision_note) || null }).eq("id", approval.id)
    }
    return { ok: true }
  } catch (e) {
    const error = errorMessage(e)
    console.error(`[admin] side effect for approval ${approval.id} (${approval.kind}) failed:`, e)
    const base = withoutFailures(approval.decision_note)
    const note = [base, `${FAILURE_PREFIX} ${error}`].filter(Boolean).join("\n")
    const { error: noteError } = await db.from("approvals").update({ decision_note: note }).eq("id", approval.id)
    if (noteError) console.error(`[admin] could not record the failure on approval ${approval.id}:`, noteError.message)
    return { ok: false, error }
  }
}
