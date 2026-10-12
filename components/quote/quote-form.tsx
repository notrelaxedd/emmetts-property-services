"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

import { submitQuote } from "@/app/actions/quote";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { content } from "@/lib/content";
import {
  MAX_PHOTOS,
  WEEKDAY_OPTIONS,
  fieldErrorsFrom,
  initialQuoteState,
  parseQuoteFormData,
  photoError,
  quoteSchema,
  type QuoteFieldErrors,
  type QuoteFormValues,
} from "@/lib/quote-schema";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import type { QuoteServiceOption } from "./services-data";
import { setInputFiles, shrinkPhotos } from "./compress-photos";
import { Turnstile } from "./turnstile";
import { UtmFields } from "./utm-fields";

const copy = content.quote.form;

type Props = {
  services: QuoteServiceOption[];
  /** Pre-checked service (`?service=<slug>`), already validated against `services` by the page. */
  defaultService?: string;
  /** True when a geocoder is configured: shows the "we'll verify the address" hint. */
  verifyAddress: boolean;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY; the widget only renders when set. */
  turnstileSiteKey: string | null;
};

/* ---------- small building blocks ---------- */

const inputClass = "h-12 rounded-xl px-4 text-base";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  /** Render prop so the control gets matching id + aria attributes. */
  children: (a: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2 block text-[0.9375rem] font-semibold leading-tight">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-muted">(optional)</span>}
      </Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** A native checkbox in a tappable row. Native (not Radix) so it submits without JavaScript. */
function CheckRow({
  name,
  value,
  defaultChecked,
  title,
  description,
  invalid,
  describedBy,
  pill,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  title: string;
  description?: string;
  invalid?: boolean;
  describedBy?: string;
  pill?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 border bg-white text-ink transition-colors has-[:checked]:border-ink has-[:checked]:bg-brand-green/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-green-dark has-[:focus-visible]:ring-offset-2",
        pill ? "min-h-11 items-center rounded-full px-4 py-2" : "min-h-12 rounded-xl p-3.5",
        invalid ? "border-destructive" : "border-input",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("size-5 shrink-0 accent-[#327213]", !pill && "mt-0.5")}
      />
      <span className="min-w-0">
        <span className="block font-semibold leading-snug">{title}</span>
        {description && <span className="mt-0.5 block text-sm font-normal leading-snug text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

function Group({
  id,
  legend,
  hint,
  error,
  children,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} className="min-w-0">
      <legend className="font-display text-xl uppercase leading-none text-ink">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <div className="mt-4">{children}</div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}

function SubmitButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  const working = pending || busy;
  return (
    <Button type="submit" variant="cta" size="cta" className="w-full sm:w-auto" disabled={working} aria-disabled={working}>
      {working ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {working ? copy.submitting : copy.submit}
      {working ? null : <ArrowRight aria-hidden="true" />}
    </Button>
  );
}

/* ---------- the form ---------- */

export function QuoteForm({ services, defaultService, verifyAddress, turnstileSiteKey }: Props) {
  const [state, formAction] = useFormState(submitQuote, initialQuoteState);
  const [clientErrors, setClientErrors] = useState<QuoteFieldErrors | null>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const serverState = state.status === "error" ? state : null;
  const nonce = serverState?.nonce ?? 0;

  // Re-seed inputs from what the user typed whenever the server answers.
  const values: QuoteFormValues = serverState?.values ?? {
    name: "",
    email: "",
    phone: "",
    address: "",
    services: defaultService ? [defaultService] : [],
    customRequest: "",
    preferredDays: [],
    emailOptIn: false,
    smsOptIn: false,
    snowList: false,
  };

  const errors: QuoteFieldErrors = { ...(clientErrors ?? serverState?.fieldErrors ?? {}) };
  if (photoMsg) errors.photos = photoMsg;

  // A fresh server response replaces any client-side errors and puts focus where the user needs it.
  useEffect(() => {
    if (!serverState) return;
    setClientErrors(null);
    setPhotoMsg(null);
    setPhotoNames([]);
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (firstInvalid ?? bannerRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => {
    if (!clientErrors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [clientErrors]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (processing) {
      e.preventDefault();
      return;
    }
    const { raw } = parseQuoteFormData(new FormData(e.currentTarget));
    const result = quoteSchema.safeParse(raw);
    if (!result.success) {
      e.preventDefault();
      setClientErrors(fieldErrorsFrom(result.error));
      return;
    }
    setClientErrors(null);
  }

  async function onPhotosChange() {
    const input = fileRef.current;
    if (!input) return;
    const picked = Array.from(input.files ?? []);
    const problem = photoError(picked);
    if (problem) {
      setPhotoMsg(problem);
      setPhotoNames([]);
      input.value = "";
      return;
    }
    setPhotoMsg(null);
    setPhotoNames(picked.map((f) => f.name));
    if (picked.length === 0) return;
    setProcessing(true);
    try {
      const shrunk = await shrinkPhotos(picked);
      setInputFiles(input, shrunk);
    } finally {
      setProcessing(false);
    }
  }

  const bannerMessage = serverState
    ? serverState.hadPhotos
      ? `${serverState.message} ${content.quote.errors.photosAgain}`
      : serverState.message
    : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      aria-label="Quote request"
      className="relative grid gap-8"
    >
      {bannerMessage && (
        <div
          ref={bannerRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{bannerMessage}</p>
        </div>
      )}

      {/* Honeypot: invisible to people and assistive tech; bots that fill it get a quiet fake success. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <Suspense fallback={null}>
        <UtmFields />
      </Suspense>

      {/* Remounting on each server response re-seeds the defaults from what the user typed. */}
      <div key={nonce} className="grid gap-8">
        <Group id="q-details" legend={copy.legend}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="q-name" label={copy.name.label} error={errors.name} className="sm:col-span-2">
              {(a) => (
                <Input
                  {...a}
                  name="name"
                  autoComplete="name"
                  enterKeyHint="next"
                  required
                  defaultValue={values.name}
                  placeholder={copy.name.placeholder}
                  className={inputClass}
                />
              )}
            </Field>
            <Field id="q-phone" label={copy.phone.label} error={errors.phone}>
              {(a) => (
                <Input
                  {...a}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  required
                  defaultValue={values.phone}
                  placeholder={copy.phone.placeholder}
                  className={inputClass}
                />
              )}
            </Field>
            <Field id="q-email" label={copy.email.label} error={errors.email}>
              {(a) => (
                <Input
                  {...a}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint="next"
                  autoCapitalize="none"
                  required
                  defaultValue={values.email}
                  placeholder={copy.email.placeholder}
                  className={inputClass}
                />
              )}
            </Field>
            <Field
              id="q-address"
              label={copy.address.label}
              hint={verifyAddress ? `${copy.address.hint} ${copy.address.verifyHint}` : copy.address.hint}
              error={errors.address}
              className="sm:col-span-2"
            >
              {(a) => (
                // TODO [GEOCODER — ask owner]: swap this for an autocomplete (Google Places / Mapbox /
                // Nominatim) once a provider is chosen. Keep `name="address"` as the submitted free text;
                // the server action geocodes it either way.
                <Input
                  {...a}
                  name="address"
                  autoComplete="street-address"
                  enterKeyHint="next"
                  required
                  defaultValue={values.address}
                  placeholder={copy.address.placeholder}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
        </Group>

        <Group id="q-services" legend={copy.services.legend} hint={copy.services.hint} error={errors.services}>
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <CheckRow
                key={s.slug}
                name="services"
                value={s.slug}
                defaultChecked={values.services.includes(s.slug)}
                title={s.name}
                description={s.blurb}
                invalid={Boolean(errors.services)}
                describedBy={errors.services ? "q-services-error" : undefined}
              />
            ))}
          </div>

          <div className="mt-6 grid gap-5">
            <Field id="q-custom" label={copy.custom.label} hint={copy.custom.hint} error={errors.customRequest}>
              {(a) => (
                <Textarea
                  {...a}
                  name="customRequest"
                  rows={4}
                  maxLength={1500}
                  defaultValue={values.customRequest}
                  placeholder={copy.custom.placeholder}
                  className="min-h-28 rounded-xl px-4 py-3 text-base"
                />
              )}
            </Field>

            <Field id="q-photos" label={copy.photos.label} hint={copy.photos.hint} error={errors.photos}>
              {(a) => (
                <>
                  <Input
                    {...a}
                    ref={fileRef}
                    name="photos"
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    onChange={onPhotosChange}
                    className="h-auto cursor-pointer rounded-xl px-4 py-3 text-base file:mr-3 file:rounded-full file:bg-ink file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                  />
                  {photoNames.length > 0 && (
                    <p className="mt-2 text-sm font-medium text-ink" aria-live="polite">
                      {copy.photos.count(Math.min(photoNames.length, MAX_PHOTOS))}
                      <span className="font-normal text-ink-muted">: {photoNames.join(", ")}</span>
                    </p>
                  )}
                </>
              )}
            </Field>
          </div>
        </Group>

        <Group id="q-days" legend={copy.days.legend} hint={copy.days.hint} error={errors.preferredDays}>
          <div className="flex flex-wrap gap-2.5">
            {WEEKDAY_OPTIONS.map((d) => (
              <CheckRow
                key={d.value}
                pill
                name="preferredDays"
                value={String(d.value)}
                defaultChecked={values.preferredDays.includes(d.value)}
                title={d.short}
              />
            ))}
          </div>
        </Group>

        <Group id="q-consent" legend={copy.consent.legend} hint={copy.consent.note}>
          <div className="grid gap-3">
            <CheckRow name="emailOptIn" value="on" defaultChecked={values.emailOptIn} title={copy.consent.email} />
            <CheckRow name="smsOptIn" value="on" defaultChecked={values.smsOptIn} title={copy.consent.sms} />
            <CheckRow name="snowList" value="on" defaultChecked={values.snowList} title={copy.consent.snow} />
          </div>
        </Group>
      </div>

      {turnstileSiteKey && (
        <div>
          <p className="mb-2 text-sm text-ink-muted">{copy.turnstile}</p>
          <Turnstile siteKey={turnstileSiteKey} resetKey={nonce} />
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <SubmitButton busy={processing} />
        <p className="text-sm text-ink-muted">
          {copy.callInstead}{" "}
          <a href={siteConfig.phone.href} className="font-semibold text-brand-green-dark underline underline-offset-4">
            {siteConfig.phone.display}
          </a>
        </p>
      </div>
    </form>
  );
}
