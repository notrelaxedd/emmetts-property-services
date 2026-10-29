"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assignmentByToken, recordCrewResponse } from "@/lib/ops";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { siteUrl } from "@/components/admin/inbox/server";

export type RespondResult =
  | { ok: true; response: "accepted" | "declined"; confirmed: boolean; changed: boolean; jobStatus: string }
  | { ok: false; error: string };

const schema = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/i), response: z.enum(["accepted", "declined"]) });

/**
 * The Available / Can't make it buttons from the crew email. The token is the only credential: it is
 * random, per offer, and only ever answers that offer. The page confirms with a POST (this action), so
 * a mail scanner following the link changes nothing.
 */
export async function respondByToken(token: string, response: "accepted" | "declined"): Promise<RespondResult> {
  const parsed = schema.safeParse({ token, response });
  if (!parsed.success) return { ok: false, error: "That link isn't valid." };
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "We can't take answers right now. Please open the crew app instead." };
  try {
    const assignment = await assignmentByToken(db, parsed.data.token);
    if (!assignment) return { ok: false, error: "This offer link has expired or the job was taken off the calendar." };
    const res = await recordCrewResponse(db, assignment, parsed.data.response, { siteUrl: siteUrl(), actor: `crew-email:${assignment.crew_id}` });
    revalidatePath("/crew", "layout");
    revalidatePath("/admin", "layout");
    return { ok: true, response: parsed.data.response, confirmed: res.confirmed, changed: res.changed, jobStatus: res.jobStatus };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try the crew app." };
  }
}
