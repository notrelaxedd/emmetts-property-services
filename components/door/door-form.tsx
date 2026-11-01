"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import { bookDoorJob } from "@/app/actions/door";
import { Button } from "@/components/ui/button";
import {
  DOOR_SERVICES,
  addDays,
  doorCopy,
  doorFieldErrorsFrom,
  doorSchema,
  doorServiceLabel,
  formatDoorDate,
  formatPhoneAsTyped,
  localIsoDate,
  type DoorField,
  type DoorFieldErrors,
  type DoorFormState,
  type DoorFormValues,
} from "@/lib/door-schema";
import { cn } from "@/lib/utils";

const FIELD_ORDER: readonly DoorField[] = ["name", "phone", "address", "date", "services"];

/** Today on this phone (the rep is standing in Ohio, so the phone's calendar is the right one). */
function todayHere(): string {
  const now = new Date();
  return localIsoDate(now, Intl.DateTimeFormat().resolvedOptions().timeZone || undefined);
}

function emptyValues(today: string): DoorFormValues {
  return { name: "", phone: "", address: "", date: addDays(today, 1), services: [] };
}

// Forest over the shared input styles. ≥16px text so iOS doesn't zoom; tall enough for a thumb.
const inputClass =
  "block h-14 w-full rounded-xl border border-forest/60 bg-white px-4 text-lg text-forest placeholder:text-forest-muted focus:border-forest focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-base font-medium text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: (a: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-semibold leading-tight text-forest">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined })}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * The /door form: five fields, one button. Everything the rep typed stays in React state, so a failed
 * save keeps it all; the server action is the real gate (the schema runs here first only for speed).
 */
export function DoorForm() {
  // Rendered on the server with Ohio's date, then re-seeded from the phone's clock after hydration.
  const [today, setToday] = useState(() => localIsoDate(new Date()));
  const [values, setValues] = useState<DoorFormValues>(() => emptyValues(today));
  const [errors, setErrors] = useState<DoorFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [booked, setBooked] = useState<Extract<DoorFormState, { status: "booked" }> | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const here = todayHere();
    if (here === today) return;
    setToday(here);
    setValues((v) => (v.date === addDays(today, 1) ? { ...v, date: addDays(here, 1) } : v));
  }, [today]);

  useEffect(() => {
    if (booked) doneRef.current?.focus();
  }, [booked]);

  const set = <K extends keyof DoorFormValues>(key: K, value: DoorFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key as DoorField]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function focusFirstInvalid(fieldErrors: DoorFieldErrors) {
    const first = FIELD_ORDER.find((f) => fieldErrors[f]);
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(first === "services" ? 'input[name="services"]' : `#door-${first}`);
    el?.focus({ preventScroll: false });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setMessage(null);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const check = doorSchema(todayHere()).safeParse(values);
    if (!check.success) {
      const fieldErrors = doorFieldErrorsFrom(check.error);
      setErrors(fieldErrors);
      focusFirstInvalid(fieldErrors);
      return;
    }
    setErrors({});

    startTransition(async () => {
      let state: DoorFormState;
      try {
        state = await bookDoorJob(formData);
      } catch {
        state = { status: "error", nonce: Date.now(), message: doorCopy.errors.failed, fieldErrors: {} };
      }
      if (state.status === "booked") {
        setBooked(state);
        return;
      }
      if (state.status === "error") {
        setErrors(state.fieldErrors);
        setMessage(state.message);
        if (state.message) bannerRef.current?.focus();
        else focusFirstInvalid(state.fieldErrors);
      }
    });
  }

  function bookAnother() {
    const here = todayHere();
    setToday(here);
    setValues(emptyValues(here));
    setErrors({});
    setMessage(null);
    setBooked(null);
  }

  if (booked) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col justify-center text-center">
        <span aria-hidden="true" className="mx-auto flex size-20 items-center justify-center rounded-full bg-forest text-cream">
          <Check className="size-10" strokeWidth={3} />
        </span>
        <h1 ref={doneRef} tabIndex={-1} className="mt-6 font-heading text-4xl font-extrabold uppercase text-forest outline-none">
          Booked <span aria-hidden="true">✓</span>
        </h1>
        <p className="mt-6 text-2xl font-semibold text-forest">{booked.name}</p>
        <p className="mt-2 text-xl text-forest">{formatDoorDate(booked.date)}</p>
        <ul className="mt-5 space-y-1 text-lg text-forest-body">
          {booked.services.map((key) => (
            <li key={key}>{doorServiceLabel(key)}</li>
          ))}
        </ul>
        <Button type="button" variant="cta" size="cta" className="mt-10 w-full" onClick={bookAnother}>
          Book another
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6">
      <h1 className="font-heading text-3xl font-extrabold uppercase text-forest">Book a job</h1>

      {message && (
        <p
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive bg-white px-4 py-3 text-base font-semibold text-destructive outline-none"
        >
          <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}

      <Field id="door-name" label="Homeowner name" error={errors.name}>
        {(a) => (
          <input
            {...a}
            name="name"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputClass}
          />
        )}
      </Field>

      <Field id="door-phone" label="Phone number" error={errors.phone}>
        {(a) => (
          <input
            {...a}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="(440) 555-1234"
            value={values.phone}
            onChange={(e) => set("phone", formatPhoneAsTyped(e.target.value))}
            className={inputClass}
          />
        )}
      </Field>

      <Field id="door-address" label="Address" error={errors.address}>
        {(a) => (
          <input
            {...a}
            name="address"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
            className={inputClass}
          />
        )}
      </Field>

      <Field id="door-date" label="Date we're going" error={errors.date}>
        {(a) => (
          <input
            {...a}
            name="date"
            type="date"
            min={today}
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            className={cn(inputClass, "appearance-none")}
          />
        )}
      </Field>

      <fieldset aria-describedby={errors.services ? "door-services-error" : undefined}>
        <legend className="mb-2 block text-base font-semibold leading-tight text-forest">What we&apos;re doing</legend>
        <div className="grid gap-2.5">
          {DOOR_SERVICES.map((s) => {
            const checked = values.services.includes(s.key);
            return (
              <label
                key={s.key}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3.5 rounded-xl border bg-white px-4 text-lg font-semibold text-forest transition-colors has-[:checked]:border-forest has-[:checked]:bg-sage has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest has-[:focus-visible]:ring-offset-2 motion-reduce:transition-none",
                  errors.services ? "border-destructive" : "border-forest/40",
                )}
              >
                <input
                  type="checkbox"
                  name="services"
                  value={s.key}
                  checked={checked}
                  aria-invalid={Boolean(errors.services) || undefined}
                  onChange={(e) =>
                    set("services", e.target.checked ? [...values.services, s.key] : values.services.filter((k) => k !== s.key))
                  }
                  className="size-6 shrink-0 accent-forest"
                />
                {s.label}
              </label>
            );
          })}
        </div>
        <FieldError id="door-services-error" message={errors.services} />
      </fieldset>

      {/* Honeypot: off-screen, hidden from assistive tech and out of the tab order. Bots fill it; people never see it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <Button type="submit" variant="cta" size="cta" className="w-full text-base" disabled={pending} aria-disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {pending ? "Booking..." : "Book it"}
      </Button>
    </form>
  );
}
