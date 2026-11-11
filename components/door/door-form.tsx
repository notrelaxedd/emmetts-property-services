"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import { submitDoorBooking } from "@/app/actions/door";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DOOR_DEFAULT_CITY, initialDoorState, type DoorField, type DoorFormValues } from "@/lib/door-schema";

type Option = { slug: string; name: string };
type Rep = { id: string; name: string };

const TOWNS = ["Rocky River", "Westlake", "Bay Village", "Lakewood"];

/** The rep's pick is kept on their phone so they only choose it once. */
const REP_KEY = "eod-door-rep-id";
function readRep(): string {
  try {
    return window.localStorage.getItem(REP_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveRep(id: string) {
  try {
    window.localStorage.setItem(REP_KEY, id);
  } catch {
    // Private mode etc.: they'll just pick it again next time.
  }
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? "Booking…" : "Book it"}
    </Button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-destructive">
      {message}
    </p>
  );
}

/** One form per booking; "Book another" remounts it empty. */
function Booking({
  services,
  reps,
  today,
  lastDay,
  onDone,
}: {
  services: Option[];
  reps: Rep[];
  today: string;
  lastDay: string;
  onDone: (summary: string) => void;
}) {
  const [state, action] = useFormState(submitDoorBooking, initialDoorState);
  const values: Partial<DoorFormValues> = state.status === "error" ? state.values : {};
  const errors: Partial<Record<DoorField, string>> = state.status === "error" ? state.fieldErrors : {};
  // Open when the rep ticks Other, and stays open (with their words) after an error.
  const [otherOn, setOtherOn] = React.useState(false);
  React.useEffect(() => {
    if (state.status === "error" && state.values.other.trim()) setOtherOn(true);
  }, [state]);

  React.useEffect(() => {
    if (state.status === "ok") onDone(state.summary);
  }, [state, onDone]);

  // Pick the saved name after mount (localStorage isn't there during server render), if they're still on the list.
  const repRef = React.useRef<HTMLSelectElement>(null);
  React.useEffect(() => {
    const saved = readRep();
    if (repRef.current && !repRef.current.value && reps.some((r) => r.id === saved)) repRef.current.value = saved;
  }, [state, reps]);

  const field = (name: DoorField) => ({
    name,
    id: `door-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `door-${name}-error` : undefined,
  });

  return (
    // Error states remount with the typed values (nonce), so nothing the rep typed is lost.
    <form
      key={state.status === "error" ? state.nonce : "new"}
      action={(fd) => {
        const rep = fd.get("rep");
        if (typeof rep === "string" && rep.trim()) saveRep(rep);
        return action(fd);
      }}
      className="space-y-5"
      noValidate
    >
      {state.status === "error" ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="door-company">Company</label>
        <input id="door-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Label htmlFor="door-rep">Your name</Label>
        <div className="mt-1">
          <NativeSelect {...field("rep")} ref={repRef} className="h-11 text-base" defaultValue={values.rep ?? ""} required>
            <option value="" disabled>
              {reps.length ? "Pick your name" : "No reps added yet"}
            </option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="mt-1 text-xs text-ink-muted">Not on the list? Ask Caden or Emmett to add you.</p>
        <FieldError id="door-rep-error" message={errors.rep} />
      </div>

      <div>
        <Label htmlFor="door-name">Homeowner name</Label>
        <Input {...field("name")} className="mt-1 h-11 text-base" autoComplete="off" defaultValue={values.name} required />
        <FieldError id="door-name-error" message={errors.name} />
      </div>

      <div>
        <Label htmlFor="door-phone">Phone</Label>
        <Input {...field("phone")} className="mt-1 h-11 text-base" type="tel" inputMode="tel" autoComplete="off" defaultValue={values.phone} required />
        <FieldError id="door-phone-error" message={errors.phone} />
      </div>

      <div>
        <Label htmlFor="door-street">Street address</Label>
        <Input {...field("street")} className="mt-1 h-11 text-base" autoComplete="off" placeholder="123 Wooster Rd" defaultValue={values.street} required />
        <FieldError id="door-street-error" message={errors.street} />
      </div>

      <div>
        <Label htmlFor="door-city">Town</Label>
        <Input {...field("city")} className="mt-1 h-11 text-base" list="door-towns" autoComplete="off" defaultValue={values.city ?? DOOR_DEFAULT_CITY} required />
        <datalist id="door-towns">
          {TOWNS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <FieldError id="door-city-error" message={errors.city} />
      </div>

      <div>
        <Label htmlFor="door-date">Day they want</Label>
        <Input {...field("date")} className="mt-1 h-11 text-base" type="date" min={today} max={lastDay} defaultValue={values.date} required />
        <FieldError id="door-date-error" message={errors.date} />
      </div>

      <fieldset aria-describedby={errors.services ? "door-services-error" : undefined}>
        <legend className="text-sm font-medium text-ink">Services</legend>
        <div className="mt-2 grid gap-2">
          {services.map((s) => (
            <label
              key={s.slug}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-input bg-white px-3 text-base text-ink shadow-sm has-[:checked]:border-ink has-[:checked]:bg-ink/5"
            >
              <input type="checkbox" name="services" value={s.slug} defaultChecked={values.services?.includes(s.slug)} className="size-5 accent-ink" />
              {s.name}
            </label>
          ))}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-input bg-white px-3 text-base text-ink shadow-sm has-[:checked]:border-ink has-[:checked]:bg-ink/5">
            <input type="checkbox" checked={otherOn} onChange={(e) => setOtherOn(e.target.checked)} className="size-5 accent-ink" />
            Other
          </label>
          {otherOn ? (
            <div>
              <Label htmlFor="door-other" className="sr-only">
                What else do they want?
              </Label>
              <Textarea
                {...field("other")}
                className="min-h-20 text-base"
                placeholder="Junk removal in the backyard, gutters on the garage…"
                maxLength={500}
                defaultValue={values.other}
                autoFocus={!values.other}
              />
              <FieldError id="door-other-error" message={errors.other} />
            </div>
          ) : null}
        </div>
        <FieldError id="door-services-error" message={errors.services} />
      </fieldset>

      <SubmitButton />
    </form>
  );
}

export function DoorForm({ services, reps, today, lastDay }: { services: Option[]; reps: Rep[]; today: string; lastDay: string }) {
  const [done, setDone] = React.useState<string | null>(null);
  const [round, setRound] = React.useState(0);

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-lg border border-ink/10 bg-white p-5 text-center shadow-sm">
        <Check className="mx-auto size-8 text-ink" aria-hidden="true" />
        <p className="text-xl font-bold text-ink">Booked</p>
        <p className="text-sm text-ink-muted">{done}</p>
        <p className="text-sm text-ink-muted">Let them know Caden or Emmett will call to confirm the price and time.</p>
        <Button
          type="button"
          className="h-12 w-full text-base"
          onClick={() => {
            setDone(null);
            setRound((r) => r + 1);
          }}
        >
          Book another
        </Button>
      </div>
    );
  }

  return <Booking key={round} services={services} reps={reps} today={today} lastDay={lastDay} onDone={setDone} />;
}
