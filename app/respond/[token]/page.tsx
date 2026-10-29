import { CalendarDays, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { assignmentByToken, servicesForJob } from "@/lib/ops";
import { formatDayLabel, formatDuration, formatTimeRange } from "@/lib/scheduler/time";
import { siteConfig } from "@/lib/site-config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { RespondForm } from "./respond-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Are you free?" };

/**
 * Landing page for the Available / Can't make it links in the crew availability email. Shows the job
 * (crew-safe: name, address, services, time; never the price or the customer's contact details) and
 * records the answer with one tap. Reading the page changes nothing.
 */
export default async function RespondPage({ params, searchParams }: { params: { token: string }; searchParams: { r?: string } }) {
  const db = getSupabaseAdmin();
  const assignment = db ? await assignmentByToken(db, params.token) : null;
  const initial = searchParams.r === "available" ? "available" : searchParams.r === "cant" ? "cant" : null;

  if (!db || !assignment) {
    return (
      <div className="space-y-4 rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-ink">This offer link isn&apos;t live any more</h1>
        <p className="text-sm text-ink-muted">
          The job was taken off the calendar, re-planned, or already confirmed. Anything still waiting for you is in the crew app.
        </p>
        <Button asChild>
          <Link href="/crew/offers">Open the crew app</Link>
        </Button>
      </div>
    );
  }

  const [{ data: job }, { data: crew }] = await Promise.all([
    db.from("jobs").select("*").eq("id", assignment.job_id).maybeSingle(),
    db.from("profiles").select("name").eq("id", assignment.crew_id).maybeSingle(),
  ]);
  const customer = job ? (await db.from("customers").select("name,address").eq("id", job.customer_id).maybeSingle()).data : null;
  const services = job ? await servicesForJob(db, job) : [];
  const start = job?.start_at ? new Date(job.start_at) : null;
  const end = job?.end_at ? new Date(job.end_at) : null;
  const live = job && (job.status === "proposed" || job.status === "crew_confirmed") && start;
  const first = crew?.name?.trim().split(/\s+/)[0] || "there";

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{siteConfig.name}</p>
      <h1 className="text-2xl font-bold text-ink">Hi {first}, are you free for this one?</h1>
      <div className="space-y-3 rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
        <p className="text-lg font-bold text-ink">{customer?.name ?? "A customer"}</p>
        {services.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Services">
            {services.map((s, i) => (
              <li key={`${s}-${i}`} className="rounded-md bg-gray-light px-2 py-1 text-sm font-medium text-ink">
                {s}
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="space-y-1.5 text-sm text-ink">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <dd>{start ? `${formatDayLabel(start)}, ${end ? formatTimeRange(start, end) : ""}` : "Day to be confirmed"}{job ? ` · ${formatDuration(job.est_minutes)}` : ""}</dd>
          </div>
          {customer?.address ? (
            <div className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <dd>{customer.address}</dd>
            </div>
          ) : null}
          {job && job.crew_size > 1 ? (
            <div className="flex items-center gap-2">
              <Users className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <dd>Crew of {job.crew_size}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {live ? (
        <RespondForm token={assignment.respond_token} initial={initial} current={assignment.status === "accepted" || assignment.status === "declined" ? assignment.status : "offered"} />
      ) : (
        <div className="space-y-3 rounded-lg border border-ink/10 bg-white p-5 shadow-sm">
          <p className="text-sm text-ink">
            {job?.status === "booked" || job?.status === "in_progress"
              ? assignment.status === "accepted"
                ? "This job is confirmed and you're on it. Details are in the crew app."
                : "This job is already confirmed with its crew. Thanks anyway!"
              : "This job isn't waiting on answers any more."}
          </p>
          <Button asChild>
            <Link href="/crew">Open the crew app</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
