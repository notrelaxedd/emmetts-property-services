import { DoorForm } from "@/components/door/door-form";
import { loadDoorReps, loadDoorServices } from "@/components/quote/services-data";
import { DOOR_MAX_DAYS_AHEAD } from "@/lib/door-schema";
import { addDays, localDate } from "@/lib/scheduler/time";

// Services come from Supabase, and "today" must be today.
export const dynamic = "force-dynamic";

export default async function DoorPage() {
  const [services, reps] = await Promise.all([loadDoorServices(), loadDoorReps()]);
  const today = localDate(new Date());
  return (
    <>
      <h1 className="text-2xl font-bold text-ink">Book a job</h1>
      <p className="mt-1 text-sm text-ink-muted">Fill this in at the door. Caden or Emmett will call them to confirm the price and time.</p>
      <div className="mt-6">
        <DoorForm services={services.map(({ slug, name }) => ({ slug, name }))} reps={reps} today={today} lastDay={addDays(today, DOOR_MAX_DAYS_AHEAD)} />
      </div>
    </>
  );
}
