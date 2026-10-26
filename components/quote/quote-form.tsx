"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Plus } from "lucide-react";

import { submitQuote } from "@/app/actions/quote";
import { CallLink } from "@/components/site/call-link";
import { ServiceGlyph } from "@/components/site/icons";
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
  type PhotoType,
  type QuoteField,
  type QuoteFieldErrors,
  type QuoteFormValues,
} from "@/lib/quote-schema";
import type { ServiceIcon } from "@/lib/services";
import { cn } from "@/lib/utils";
import type { QuoteServiceOption } from "./services-data";
import { AddressAutocomplete } from "./address-autocomplete";
import { setInputFiles, shrinkPhotos } from "./compress-photos";
import { Turnstile } from "./turnstile";
import { sniffFileType, uploadPhotosDirect } from "./upload-photos";
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

/**
 * One picked photo. `local` = not uploaded ahead of time; the file input still holds it and it goes
 * with the form (the original behaviour, and the fallback when the direct upload fails entirely).
 */
/**
 * Photo uploads are switched off: the owner decided they aren't needed, and mobile Safari was
 * submitting empty files. Flip to true to bring the field (and its direct-to-storage upload) back.
 */
const PHOTOS_ENABLED = false;

type PhotoRow = {
  id: number;
  name: string;
  file: File;
  type: PhotoType | null;
  status: "uploading" | "done" | "error" | "local";
  /** `pending/<batch>/<n>.<ext>` once uploaded. */
  path?: string;
  error?: string;
};

/**
 * The form is split into short steps; these are the fields on each, so a validation error can send
 * the customer back to the step it belongs to. Without JavaScript every step shows at once.
 */
const STEP_FIELDS: ReadonlyArray<readonly QuoteField[]> = [
  ["services", "customRequest", "photos"],
  ["street", "city", "state", "zip", "preferredDays"],
  ["name", "phone", "email"],
];
const LAST_STEP = STEP_FIELDS.length - 1;

/** With JavaScript off: hide the step chrome (progress, Back/Next) and show every step and the submit button. */
const NO_JS_CSS =
  "<style>[data-quote-js]{display:none!important}[data-quote-step]{display:grid!important}[data-quote-submit]{display:inline-flex!important}</style>";

function firstStepWithError(errors: QuoteFieldErrors): number | null {
  const i = STEP_FIELDS.findIndex((fields) => fields.some((f) => errors[f]));
  return i === -1 ? null : i;
}

function pickErrors(errors: QuoteFieldErrors, fields: readonly QuoteField[]): QuoteFieldErrors {
  const out: QuoteFieldErrors = {};
  for (const f of fields) if (errors[f]) out[f] = errors[f];
  return out;
}

/* ---------- small building blocks ---------- */

// Forest over the shared input styles (the owner console's stay gray). /60 keeps the border above 3:1 on white.
const controlSkin = "border-forest/60 text-forest shadow-none placeholder:text-forest-muted/70";
const inputClass = `h-12 rounded-xl px-4 text-base ${controlSkin}`;

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
      <Label htmlFor={id} className="mb-2 block text-[0.9375rem] font-semibold leading-tight text-forest">
        {label}
        {optional && <span className="ml-1.5 font-normal text-forest-muted">(optional)</span>}
      </Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-forest-muted">
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
  icon,
  descriptionFrom,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  title: string;
  description?: string;
  invalid?: boolean;
  describedBy?: string;
  pill?: boolean;
  icon?: ServiceIcon;
  /** Hide the description on phones, where it would make the list long. */
  descriptionFrom?: "sm";
}) {
  return (
    <label
      className={cn(
        // Ticked rows fill with sage and take a forest edge, like the home page's quiet panels.
        "flex cursor-pointer items-start gap-3 border bg-white text-forest transition-colors has-[:checked]:border-forest has-[:checked]:bg-sage has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-forest has-[:focus-visible]:ring-offset-2 motion-reduce:transition-none",
        pill ? "min-h-11 items-center rounded-full px-4 py-2" : "min-h-12 rounded-xl p-3.5",
        descriptionFrom === "sm" && "items-center sm:items-start",
        invalid ? "border-destructive" : "border-forest/25 hover:border-forest/60",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("size-5 shrink-0 accent-forest", !pill && (descriptionFrom === "sm" ? "sm:mt-0.5" : "mt-0.5"))}
      />
      <span className="min-w-0">
        <span className="block font-semibold leading-snug">{title}</span>
        {description && (
          <span
            className={cn(
              "mt-0.5 text-sm font-normal leading-snug text-forest-muted",
              descriptionFrom === "sm" ? "hidden sm:block" : "block",
            )}
          >
            {description}
          </span>
        )}
      </span>
      {icon && (
        // The badge's thin ring at icon scale (IconBadge's look; ServiceGlyph's heavier stroke thinned to match).
        <span className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-forest text-forest">
          <ServiceGlyph icon={icon} className="size-[1.125rem] [stroke-width:1.5]" />
        </span>
      )}
    </label>
  );
}

function Group({
  id,
  legend,
  hint,
  error,
  sub,
  children,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  /** A secondary group within a step: smaller legend. */
  sub?: boolean;
  children: ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset aria-describedby={describedBy} className="min-w-0">
      {/* Step titles in the badge's heavy caps; secondary groups in the small letterspaced caps /contact uses. */}
      <legend
        className={cn(
          "font-heading uppercase text-forest",
          sub ? "text-sm font-bold leading-snug tracking-[0.12em]" : "text-[1.375rem] font-extrabold leading-[1.1] sm:text-[1.625rem]",
        )}
      >
        {legend}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-sm text-forest-muted">
          {hint}
        </p>
      )}
      <div className="mt-4">{children}</div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}

function SubmitButton({ busy, hidden }: { busy: boolean; hidden: boolean }) {
  const { pending } = useFormStatus();
  const working = pending || busy;
  return (
    <Button
      type="submit"
      variant="cta"
      size="cta"
      data-quote-submit
      // The longest label on the site: a touch tighter on phones so it stays on one line from 375px,
      // and below that it wraps rather than pushing the page sideways.
      className={cn(
        "h-auto min-h-14 w-full whitespace-normal px-5 py-3 text-center text-[0.875rem] leading-snug tracking-[0.08em] sm:w-auto sm:px-9 sm:text-[0.9375rem] sm:tracking-[0.14em]",
        hidden && "hidden",
      )}
      disabled={working}
      aria-disabled={working}
    >
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
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(0);
  // Focus moves after the render that shows the right step, so it's requested here and applied in an effect.
  const [focusReq, setFocusReq] = useState<{ target: "step" | "invalid" | "banner"; n: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLParagraphElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef(0);
  const rowIdRef = useRef(0);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const serverState = state.status === "error" ? state : null;
  const nonce = serverState?.nonce ?? 0;

  // Re-seed inputs from what the user typed whenever the server answers.
  const values: QuoteFormValues = serverState?.values ?? {
    name: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "OH",
    zip: "",
    services: defaultService ? [defaultService] : [],
    customRequest: "",
    preferredDays: [],
    emailOptIn: false,
    smsOptIn: false,
    snowList: false,
  };

  const errors: QuoteFieldErrors = { ...(clientErrors ?? serverState?.fieldErrors ?? {}) };
  if (photoMsg) errors.photos = photoMsg;

  const requestFocus = (target: "step" | "invalid" | "banner") => setFocusReq((prev) => ({ target, n: (prev?.n ?? 0) + 1 }));

  /** Shows the step holding the first error, if any, and focuses that field (or the banner). */
  function showErrors(fieldErrors: QuoteFieldErrors, fallback: "invalid" | "banner") {
    const s = firstStepWithError(fieldErrors);
    if (s !== null) setStep(s);
    requestFocus(fallback);
  }

  // A fresh server response replaces any client-side errors and puts focus where the user needs it.
  useEffect(() => {
    if (!serverState) return;
    setClientErrors(null);
    setPhotoMsg(null);
    // Photos already in storage stay valid after a failed submit; ones that travelled with the form
    // were wiped along with the remounted file input, so the banner asks for those again.
    setPhotos((prev) => prev.filter((p) => p.status === "done"));
    showErrors(serverState.fieldErrors, "banner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => {
    if (!focusReq) return;
    const form = formRef.current;
    if (focusReq.target === "step") {
      progressRef.current?.focus({ preventScroll: true });
      // Next sits at the bottom of the step; bring the top of the new one into view (clear of the sticky header).
      const headerOffset = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      if (form && form.getBoundingClientRect().top < headerOffset) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        form.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      }
      return;
    }
    const invalid = form?.querySelector<HTMLElement>('[data-quote-step]:not(.hidden) [aria-invalid="true"]');
    (invalid ?? (focusReq.target === "banner" ? bannerRef.current : null))?.focus();
  }, [focusReq]);

  /** Validates the fields on this step and moves on, or shows what needs fixing. */
  function goNext() {
    const form = formRef.current;
    if (!form || step === LAST_STEP) return;
    const { raw } = parseQuoteFormData(new FormData(form));
    const result = quoteSchema.safeParse(raw);
    const all = result.success ? {} : fieldErrorsFrom(result.error);
    const here = pickErrors(all, STEP_FIELDS[step]);
    // Errors further on that are already showing (from the server) stay until they're fixed.
    const later = STEP_FIELDS.slice(step + 1).flat().filter((f) => errors[f]);
    const keep = pickErrors(all, later);
    if (Object.keys(here).length > 0) {
      setClientErrors({ ...keep, ...here });
      requestFocus("invalid");
      return;
    }
    setClientErrors(keep);
    setStep(step + 1);
    requestFocus("step");
  }

  function goBack() {
    if (step === 0) return;
    setStep(step - 1);
    requestFocus("step");
  }

  // Enter in a field on an earlier step moves on rather than submitting.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing || step === LAST_STEP) return;
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    goNext();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (step < LAST_STEP) {
      e.preventDefault();
      goNext();
      return;
    }
    if (processing) {
      e.preventDefault();
      return;
    }
    if (photos.some((p) => p.status === "uploading")) {
      e.preventDefault();
      return;
    }
    // Some uploaded and some not: submitting would silently drop the rest.
    if (photos.some((p) => p.status === "error")) {
      e.preventDefault();
      setPhotoMsg(copy.photos.partialFail);
      fileRef.current?.focus();
      return;
    }
    const { raw } = parseQuoteFormData(new FormData(e.currentTarget));
    const result = quoteSchema.safeParse(raw);
    if (!result.success) {
      e.preventDefault();
      const fieldErrors = fieldErrorsFrom(result.error);
      setClientErrors(fieldErrors);
      showErrors(fieldErrors, "invalid");
      return;
    }
    setClientErrors(null);
  }

  /** Uploads these rows straight to storage. `pick` guards against a newer file pick landing meanwhile. */
  async function uploadRows(rows: PhotoRow[], pick: number) {
    const todo = rows.filter((r): r is PhotoRow & { type: PhotoType } => r.type !== null);
    const ids = new Set(todo.map((r) => r.id));
    setPhotos((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, status: "uploading", error: undefined } : p)));
    await uploadPhotosDirect(
      todo.map((r) => ({ file: r.file, type: r.type })),
      (i, res) => {
        if (pickRef.current !== pick) return;
        const id = todo[i].id;
        setPhotos((prev) =>
          prev.map((p) =>
            p.id !== id
              ? p
              : res.status === "done"
                ? { ...p, status: "done", path: res.path, error: undefined }
                : { ...p, status: "error", error: res.error },
          ),
        );
      },
    );
    if (pickRef.current !== pick) return;
    // Nothing got through (offline, blocked, misconfigured): fall back to sending the files with the
    // form, as before. If only some failed, keep them as errors so the user can retry.
    setPhotos((prev) =>
      prev.some((p) => p.status === "done")
        ? prev
        : prev.map((p) => (p.status === "error" || p.status === "uploading" ? { ...p, status: "local" } : p)),
    );
  }

  async function onPhotosChange() {
    const input = fileRef.current;
    if (!input) return;
    const picked = Array.from(input.files ?? []);
    const problem = photoError(picked);
    const pick = ++pickRef.current;
    if (problem) {
      setPhotoMsg(problem);
      setPhotos([]);
      setProcessing(false);
      input.value = "";
      return;
    }
    setPhotoMsg(null);
    if (picked.length === 0) {
      setPhotos([]);
      setProcessing(false);
      return;
    }
    setProcessing(true);
    try {
      const shrunk = await shrinkPhotos(picked);
      setInputFiles(input, shrunk);
      const types = await Promise.all(shrunk.map((f) => sniffFileType(f)));
      if (pickRef.current !== pick) return;
      // If any file isn't a recognisable image, skip the direct upload and let the server explain.
      const direct = types.every((t) => t !== null);
      const rows: PhotoRow[] = shrunk.map((file, i) => ({
        id: ++rowIdRef.current,
        name: picked[i]?.name ?? file.name,
        file,
        type: types[i],
        status: direct ? "uploading" : "local",
      }));
      setPhotos(rows);
      if (direct) await uploadRows(rows, pick);
    } finally {
      if (pickRef.current === pick) setProcessing(false);
    }
  }

  async function retryPhotos() {
    const rows = photos.filter((p) => p.status === "error" || p.status === "local");
    if (rows.length === 0 || processing) return;
    const pick = pickRef.current;
    setPhotoMsg(null);
    setProcessing(true);
    try {
      await uploadRows(rows, pick);
    } finally {
      if (pickRef.current === pick) setProcessing(false);
    }
  }

  // Uploaded photos travel as hidden `photo_paths`; the file input is left unnamed (an unnamed input
  // is not submitted) so the bytes never go through the server action. With no direct upload in play
  // (no JS, upload failed) it stays named `photos` and the files go with the form.
  const uploadedPaths = photos.flatMap((p) => (p.status === "done" && p.path ? [p.path] : []));
  const sendingDirect = photos.some((p) => p.status === "uploading" || p.status === "done" || p.status === "error");
  const canRetry = photos.some((p) => p.status === "error" || p.status === "local") && photos.every((p) => p.type !== null);
  const photoStatusText = (p: PhotoRow) =>
    p.status === "uploading"
      ? copy.photos.uploading
      : p.status === "done"
        ? copy.photos.uploaded
        : p.status === "local"
          ? copy.photos.withForm
          : (p.error ?? copy.photos.failed);

  const bannerMessage = serverState
    ? serverState.hadPhotos
      ? `${serverState.message} ${content.quote.errors.photosAgain}`
      : serverState.message
    : null;

  const steps = copy.steps;
  const stepProps = (i: number) => ({
    "data-quote-step": true,
    className: cn("gap-8", i === step ? "grid" : "hidden"),
  });

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label="Quote request"
      className="relative grid gap-8"
    >
      <noscript dangerouslySetInnerHTML={{ __html: NO_JS_CSS }} />

      <div data-quote-js className="grid gap-3">
        <p
          ref={progressRef}
          tabIndex={-1}
          className="font-heading text-xs font-semibold uppercase tracking-[0.26em] text-forest outline-none"
        >
          {copy.progress(step + 1, steps.length)}
          <span className="sr-only">: {steps[step].title}</span>
        </p>
        <ol aria-label="Progress" className="grid grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <li key={s.label} aria-current={i === step ? "step" : undefined} className="grid gap-2.5">
              {/* Thin rules, like the lines either side of the badge's PROPERTY SERVICES. */}
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                  i <= step ? "bg-forest" : "bg-forest/10",
                )}
              />
              <span
                className={cn(
                  "flex items-center gap-1 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] sm:text-xs sm:tracking-[0.14em]",
                  i <= step ? "text-forest" : "text-forest-muted",
                )}
              >
                {/* The filled rule already shows it's done; the tick only fits beside the label from sm up. */}
                {i < step && <Check className="hidden size-3.5 shrink-0 text-forest sm:block" aria-hidden="true" strokeWidth={2.5} />}
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

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

      {uploadedPaths.map((path) => (
        <input key={path} type="hidden" name="photo_paths" value={path} />
      ))}

      {/* Remounting on each server response re-seeds the defaults from what the user typed. Inactive
          steps are only hidden, so their fields are still submitted. */}
      <div key={nonce} className="grid gap-8">
        <div {...stepProps(0)}>
          <Group id="q-services" legend={steps[0].title} hint={copy.services.hint} error={errors.services}>
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <CheckRow
                  key={s.slug}
                  name="services"
                  value={s.slug}
                  defaultChecked={values.services.includes(s.slug)}
                  title={s.name}
                  description={s.blurb}
                  descriptionFrom="sm"
                  icon={s.icon}
                  invalid={Boolean(errors.services)}
                  describedBy={errors.services ? "q-services-error" : undefined}
                />
              ))}
            </div>

            <div className="mt-5 grid gap-5">
              {/* Collapsed until wanted; opens itself when there's something in it or the list needs it. */}
              <details
                open={Boolean(values.customRequest || errors.customRequest || errors.services)}
                className="group rounded-xl border border-dashed border-forest/40 transition-colors hover:border-forest/70 open:border-solid open:border-forest/25 open:p-4 motion-reduce:transition-none"
              >
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 font-semibold text-forest group-open:mb-3 group-open:min-h-0 group-open:px-0 [&::-webkit-details-marker]:hidden">
                  <Plus
                    className="size-5 text-forest transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    aria-hidden="true"
                    strokeWidth={2}
                  />
                  {copy.custom.toggle}
                </summary>
                <Field id="q-custom" label={copy.custom.label} hint={copy.custom.hint} error={errors.customRequest}>
                  {(a) => (
                    <Textarea
                      {...a}
                      name="customRequest"
                      rows={3}
                      maxLength={1500}
                      defaultValue={values.customRequest}
                      placeholder={copy.custom.placeholder}
                      className={`min-h-24 rounded-xl px-4 py-3 text-base ${controlSkin}`}
                    />
                  )}
                </Field>
              </details>

              {PHOTOS_ENABLED && (
              <Field id="q-photos" label={copy.photos.label} hint={copy.photos.hint} error={errors.photos}>
                {(a) => (
                  <>
                    <Input
                      {...a}
                      ref={fileRef}
                      name={sendingDirect ? undefined : "photos"}
                      type="file"
                      accept="image/*"
                      multiple
                      capture="environment"
                      onChange={onPhotosChange}
                      className={`h-auto cursor-pointer rounded-xl px-4 py-3 text-base file:mr-3 file:rounded-full file:bg-forest file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-cream ${controlSkin}`}
                    />
                    {photos.length > 0 && (
                      <div className="mt-2 text-sm" aria-live="polite">
                        <p className="font-medium text-forest">{copy.photos.count(Math.min(photos.length, MAX_PHOTOS))}</p>
                        <ul className="mt-1 grid gap-1">
                          {photos.map((p) => (
                            <li key={p.id} className="flex flex-wrap gap-x-2 text-forest-muted">
                              <span className="min-w-0 break-all">{p.name}</span>
                              <span className={cn("font-medium", p.status === "error" ? "text-destructive" : "text-forest")}>
                                {photoStatusText(p)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {photos.some((p) => p.status === "local") && photos.every((p) => p.type !== null) && (
                          <p className="mt-1.5 text-forest-muted">{copy.photos.fallbackNote}</p>
                        )}
                        {canRetry && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2 h-11 rounded-full border-forest/60 bg-white px-4 text-forest shadow-none hover:bg-sage hover:text-forest"
                            disabled={processing}
                            onClick={retryPhotos}
                          >
                            {copy.photos.retry}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Field>
              )}
            </div>
          </Group>
        </div>

        <div {...stepProps(1)}>
          <Group id="q-address" legend={steps[1].title}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="q-street"
                label={copy.street.label}
                hint={verifyAddress ? `${copy.address.hint} ${copy.address.verifyHint}` : copy.address.hint}
                error={errors.street}
                className="sm:col-span-2"
              >
                {(a) => (
                  // Plain text box without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; with it, Google Places
                  // suggestions on the street line fill city/state/ZIP plus hidden lat/lng. Every
                  // address part is always submitted as free text.
                  <AddressAutocomplete
                    {...a}
                    autoComplete="address-line1"
                    enterKeyHint="next"
                    required
                    defaultValue={values.street}
                    placeholder={copy.street.placeholder}
                    className={inputClass}
                    cityRef={cityRef}
                    stateRef={stateRef}
                    zipRef={zipRef}
                  />
                )}
              </Field>
              <div className="grid grid-cols-6 gap-x-3 gap-y-5 sm:col-span-2 sm:gap-x-5">
                <Field id="q-city" label={copy.city.label} error={errors.city} className="col-span-6 sm:col-span-3">
                  {(a) => (
                    <Input
                      {...a}
                      ref={cityRef}
                      name="city"
                      autoComplete="address-level2"
                      enterKeyHint="next"
                      required
                      defaultValue={values.city}
                      placeholder={copy.city.placeholder}
                      className={inputClass}
                    />
                  )}
                </Field>
                <Field id="q-state" label={copy.state.label} error={errors.state} className="col-span-2 sm:col-span-1">
                  {(a) => (
                    <Input
                      {...a}
                      ref={stateRef}
                      name="state"
                      autoComplete="address-level1"
                      autoCapitalize="characters"
                      enterKeyHint="next"
                      maxLength={2}
                      required
                      defaultValue={values.state}
                      placeholder={copy.state.placeholder}
                      className={cn(inputClass, "uppercase")}
                    />
                  )}
                </Field>
                <Field id="q-zip" label={copy.zip.label} error={errors.zip} className="col-span-4 sm:col-span-2">
                  {(a) => (
                    <Input
                      {...a}
                      ref={zipRef}
                      name="zip"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      enterKeyHint="next"
                      maxLength={10}
                      required
                      defaultValue={values.zip}
                      placeholder={copy.zip.placeholder}
                      className={inputClass}
                    />
                  )}
                </Field>
              </div>
            </div>
          </Group>

          <Group id="q-days" sub legend={copy.days.legend} hint={copy.days.hint} error={errors.preferredDays}>
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
        </div>

        <div {...stepProps(2)}>
          <Group id="q-details" legend={steps[2].title}>
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
            </div>
          </Group>

          <Group id="q-consent" sub legend={copy.consent.legend} hint={copy.consent.note}>
            <div className="grid gap-3">
              <CheckRow name="emailOptIn" value="on" defaultChecked={values.emailOptIn} title={copy.consent.email} />
              <CheckRow name="smsOptIn" value="on" defaultChecked={values.smsOptIn} title={copy.consent.sms} />
              <CheckRow name="snowList" value="on" defaultChecked={values.snowList} title={copy.consent.snow} />
            </div>
          </Group>

          {/* Stays mounted on every step: Turnstile renders implicitly when its script first loads. */}
          {turnstileSiteKey && (
            <div>
              <p className="mb-2 text-sm text-forest-muted">{copy.turnstile}</p>
              <Turnstile siteKey={turnstileSiteKey} resetKey={nonce} />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {step > 0 && (
            <Button type="button" variant="cta-outline" size="cta" data-quote-js className="w-full px-8 sm:w-auto" onClick={goBack}>
              <ArrowLeft aria-hidden="true" />
              {copy.back}
            </Button>
          )}
          {step < LAST_STEP && (
            <Button type="button" variant="cta" size="cta" data-quote-js className="w-full sm:w-auto" onClick={goNext}>
              {copy.next}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
          <SubmitButton busy={processing} hidden={step < LAST_STEP} />
        </div>
        <CallLink prompt={copy.callInstead} />
      </div>
    </form>
  );
}
