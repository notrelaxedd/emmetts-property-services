import { ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { loadParentWeek } from "@/lib/parent/load";
import type { ParentDay, ParentEntry } from "@/lib/parent/schedule";
import { addDays, formatTimeRange, localDate, weekStart } from "@/lib/scheduler/time";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Always the live schedule, and "today" must be today.
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const asUtcNoon = (d: string) => new Date(`${d}T12:00:00Z`);

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

const KIND_STYLE: Record<ParentEntry["kind"], string> = {
  job: "border-l-brand-green",
  mow: "border-l-pine",
  snow: "border-l-sky-500",
};

function Entry({ e }: { e: ParentEntry }) {
  const multi = e.places.length > 1;
  return (
    <li className={`rounded-lg border border-ink/10 border-l-4 bg-white p-4 shadow-sm ${KIND_STYLE[e.kind]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-base font-bold text-ink">
          <Clock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          {formatTimeRange(new Date(e.start), new Date(e.end))}
        </p>
        {e.note ? <span className="shrink-0 rounded-md bg-gray-light px-2 py-0.5 text-xs font-semibold text-ink-muted">{e.note}</span> : null}
      </div>
      <p className="mt-1 text-sm font-medium text-ink">
        {e.title}
        {multi ? ` · ${e.places.length} stops` : ""}
      </p>
      <ul className="mt-2 space-y-1.5">
        {e.places.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-ink">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              {p.address === "Address not on file" ? (
                p.address
              ) : (
                <a href={mapsUrl(p.address)} target="_blank" rel="noopener noreferrer" className="underline decoration-ink/30 underline-offset-2">
                  {p.address}
                </a>
              )}
              {multi && p.start && p.end ? <span className="text-ink-muted"> · {formatTimeRange(new Date(p.start), new Date(p.end))}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Day({ day, today }: { day: ParentDay; today: string }) {
  const isToday = day.date === today;
  const past = day.date < today;
  return (
    <section aria-labelledby={`d-${day.date}`} className={past ? "opacity-60" : undefined}>
      <h2 id={`d-${day.date}`} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
        {dayFmt.format(asUtcNoon(day.date))}
        {isToday ? <span className="rounded-md bg-brand-green-dark px-1.5 py-0.5 text-[11px] font-bold text-white">Today</span> : null}
      </h2>
      {day.entries.length ? (
        <ul className="mt-2 space-y-2">
          {day.entries.map((e, i) => (
            <Entry key={i} e={e} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">Not working</p>
      )}
    </section>
  );
}

export default async function ParentPage({ searchParams }: { searchParams: { week?: string } }) {
  const today = localDate(new Date());
  const thisMonday = weekStart(today);
  const monday = searchParams.week && DATE_RE.test(searchParams.week) ? weekStart(searchParams.week) : thisMonday;
  const db = getSupabaseAdmin();

  let days: ParentDay[] | null = null;
  if (db) {
    try {
      days = await loadParentWeek(db, monday);
    } catch (err) {
      console.error(err);
    }
  }

  const prev = addDays(monday, -7);
  const next = addDays(monday, 7);
  const navBtn = "inline-flex items-center gap-1 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow-sm";

  return (
    <>
      <h1 className="text-2xl font-bold text-ink">Where I&apos;m working</h1>
      <p className="mt-1 text-sm text-ink-muted">EOD Lawns jobs for the week. Tap an address to open it in Maps.</p>

      <nav className="mt-5 flex items-center justify-between" aria-label="Week">
        <Link href={`/parent?week=${prev}`} className={navBtn}>
          <ChevronLeft className="size-4" aria-hidden="true" /> Prev
        </Link>
        <span className="text-sm font-semibold text-ink">
          {shortFmt.format(asUtcNoon(monday))} – {shortFmt.format(asUtcNoon(addDays(monday, 6)))}
        </span>
        <Link href={`/parent?week=${next}`} className={navBtn}>
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </nav>
      {monday !== thisMonday ? (
        <p className="mt-2 text-center text-sm">
          <Link href="/parent" className="font-semibold text-ink underline underline-offset-2">
            Back to this week
          </Link>
        </p>
      ) : null}

      {days ? (
        <div className="mt-6 space-y-6">
          {days.map((d) => (
            <Day key={d.date} day={d} today={today} />
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-lg border border-ink/10 bg-white p-5 text-sm text-ink shadow-sm">The schedule can&apos;t be loaded right now. Try again in a minute.</p>
      )}
    </>
  );
}
