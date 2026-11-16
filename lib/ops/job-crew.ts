/**
 * Change who's on a job after the customer confirmed it (booked / in progress). The owner's pick
 * stands: anyone active can be put on, whatever their hours say. Emailing them is optional.
 *
 * Plain Node (relative imports).
 */
import type { Job, JobAssignment, Profile } from "../db/types";
import { escapeHtml, getEmailProvider } from "../email";
import { decideApproval } from "./approvals";
import { loadJob, newRespondToken, slotLabel } from "./crew-offers";
import { servicesForJob } from "./jobs";
import { siteConfig } from "../site-config";
import { check } from "./types";
import type { Db } from "./types";

export const CREW_EDITABLE: Job["status"][] = ["booked", "in_progress"];

export type SetJobCrewResult = { added: string[]; removed: string[]; emailed: number };

export async function setJobCrew(
  db: Db,
  jobId: string,
  crewIds: string[],
  opts: { notify: boolean; actor: string; siteUrl: string },
): Promise<SetJobCrewResult> {
  const job = await loadJob(db, jobId);
  if (!CREW_EDITABLE.includes(job.status)) {
    throw new Error(
      job.status === "proposed" || job.status === "crew_confirmed"
        ? "This job isn't confirmed yet: pick the crew when you book it."
        : `A ${job.status.replace("_", " ")} job's crew can't be changed.`,
    );
  }
  const wanted = Array.from(new Set(crewIds));
  const profiles = wanted.length ? check(await db.from("profiles").select("*").in("id", wanted), "setJobCrew(profiles)") ?? [] : [];
  for (const id of wanted) {
    const p = profiles.find((x) => x.id === id);
    if (!p || p.role !== "crew" || p.removed_at) throw new Error(`${p?.name ?? "That person"} isn't on the active crew.`);
  }

  const rows = check(await db.from("job_assignments").select("*").eq("job_id", jobId), "setJobCrew(rows)") ?? [];
  const now = new Date().toISOString();
  const keep = new Set(wanted);
  const onBefore = new Set(rows.filter((r) => r.status !== "declined" && r.status !== "dropped").map((r) => r.crew_id));
  const added: string[] = [];
  const removedRows: JobAssignment[] = [];

  for (const row of rows) {
    if (keep.has(row.crew_id)) {
      if (row.status !== "accepted") {
        check(
          await db.from("job_assignments").update({ status: "accepted", responded_at: row.responded_at ?? now, swap_to_crew_id: null }).eq("id", row.id),
          "setJobCrew(accept)",
        );
      }
      if (!onBefore.has(row.crew_id)) added.push(row.crew_id);
    } else {
      check(await db.from("job_assignments").delete().eq("id", row.id), "setJobCrew(remove)");
      if (onBefore.has(row.crew_id)) removedRows.push(row);
    }
  }
  const have = new Set(rows.map((r) => r.crew_id));
  for (const id of wanted) {
    if (have.has(id)) continue;
    check(
      await db.from("job_assignments").insert({
        job_id: jobId,
        crew_id: id,
        status: "accepted",
        responded_at: now,
        respond_token: newRespondToken(),
        notified_at: opts.notify ? now : null,
      }),
      "setJobCrew(add)",
    );
    added.push(id);
  }

  // Drop / swap requests from people you just took off are settled.
  if (removedRows.length) {
    const pending =
      check(
        await db
          .from("approvals")
          .select("id")
          .eq("ref_table", "job_assignments")
          .in("ref_id", removedRows.map((r) => r.id))
          .eq("status", "pending"),
        "setJobCrew(approvals)",
      ) ?? [];
    for (const a of pending) {
      await decideApproval(db, a.id, "rejected", { decidedBy: opts.actor, note: "Crew changed on the schedule." }).catch(() => undefined);
    }
  }

  if (wanted.length !== job.crew_size) {
    check(await db.from("jobs").update({ crew_size: Math.max(1, wanted.length) }).eq("id", jobId), "setJobCrew(size)");
  }

  const removed = removedRows.map((r) => r.crew_id);
  let emailed = 0;
  if (opts.notify && (added.length || removed.length)) {
    const people = check(await db.from("profiles").select("*").in("id", [...added, ...removed]), "setJobCrew(people)") ?? [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const customer = check(await db.from("customers").select("name,address").eq("id", job.customer_id).maybeSingle(), "setJobCrew(customer)");
    const services = await servicesForJob(db, job);
    const provider = getEmailProvider();
    const send = async (p: Profile | undefined, on: boolean) => {
      if (!p?.email) return;
      const mail = crewChangeEmail({ crewName: p.name, on, customerName: customer?.name ?? "a customer", address: customer?.address ?? null, services, job, siteUrl: opts.siteUrl });
      try {
        await provider.send({ to: p.email, subject: mail.subject, text: mail.text, html: mail.html });
        emailed++;
      } catch (e) {
        console.error(`[job-crew] could not email ${p.email} about job ${jobId}:`, e instanceof Error ? e.message : e);
      }
    };
    for (const id of added) await send(byId.get(id), true);
    for (const id of removed) await send(byId.get(id), false);
  }
  return { added, removed, emailed };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/** "You're on a job" / "You're off a job". */
export function crewChangeEmail(input: {
  crewName: string;
  on: boolean;
  customerName: string;
  address: string | null;
  services: string[];
  job: Pick<Job, "start_at" | "end_at" | "est_minutes">;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const when = slotLabel(input.job);
  const what = input.services.length ? input.services.join(", ") : "a job";
  const app = `${input.siteUrl.replace(/\/+$/, "")}/crew`;
  const subject = input.on ? `You're on: ${what} for ${input.customerName}, ${when}` : `You're off: ${what} for ${input.customerName}, ${when}`;
  const lead = input.on ? "You've been put on this job:" : "You've been taken off this job, so you don't need to go:";
  const text = [
    `Hi ${firstName(input.crewName)},`,
    "",
    lead,
    "",
    `  ${what} for ${input.customerName}`,
    `  ${when}`,
    input.address ? `  ${input.address}` : null,
    "",
    input.on ? `It's in the crew app: ${app}` : "Questions? Text Caden or Emmett.",
    "",
    "Thanks,",
    siteConfig.name,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:16px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;">
<tr><td style="padding:20px 24px;background:#166534;color:#ffffff;font-size:18px;font-weight:600;border-radius:8px 8px 0 0;">${escapeHtml(siteConfig.name)}</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5;color:#1f2937;">
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName(input.crewName))},</p>
<p style="margin:0 0 16px;">${escapeHtml(lead)}</p>
<p style="margin:0 0 16px;padding:12px 16px;background:#f3f4f6;border-radius:8px;"><strong>${escapeHtml(what)}</strong> for ${escapeHtml(input.customerName)}<br>${escapeHtml(when)}${input.address ? `<br>${escapeHtml(input.address)}` : ""}</p>
${input.on ? `<p style="margin:0;font-size:14px;color:#6b7280;">It's in the <a href="${escapeHtml(app)}" style="color:#166534;">crew app</a>.</p>` : ""}
</td></tr></table></body></html>`;
  return { subject, text, html };
}
