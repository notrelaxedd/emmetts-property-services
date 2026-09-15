"use client";

import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Phone } from "lucide-react";

import { submitBooking } from "@/app/actions/booking";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { bookingSchema, formatPhone, todayISO, type BookingData, type BookingField, type BookingInput } from "@/lib/booking-schema";
import { content } from "@/lib/content";
import { getService, services } from "@/lib/services";
import { siteConfig } from "@/lib/site-config";
import { ServiceFromQuery } from "./service-from-query";

const copy = content.booking.form;

const emptyValues: BookingInput = {
  name: "",
  email: "",
  phone: "",
  address: "",
  service: "",
  preferredDate: "",
  notes: "",
  company: "",
};

type Confirmation = { name: string; phone: string; service: string };

export function BookingForm() {
  const form = useForm<BookingInput, unknown, BookingData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: emptyValues,
    mode: "onTouched",
  });

  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Set after mount so the static HTML never bakes in a stale build-day date.
  const [minDate, setMinDate] = useState<string | undefined>(undefined);
  const successRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMinDate(todayISO()), []);

  useEffect(() => {
    if (confirmation) successRef.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
  }, [serverError]);

  function onSubmit(values: BookingData) {
    setServerError(null);
    startTransition(async () => {
      try {
        const result = await submitBooking(values);
        if (result.ok) {
          setConfirmation({
            name: values.name.split(/\s+/)[0] ?? values.name,
            phone: formatPhone(values.phone),
            service: getService(values.service)?.title ?? "service",
          });
          form.reset(emptyValues);
          return;
        }
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            form.setError(field as BookingField, { type: "server", message });
          }
        }
        setServerError(result.message);
      } catch {
        setServerError(content.booking.errors.generic);
      }
    });
  }

  if (confirmation) {
    const success = content.booking.success;
    return (
      <div className="flex flex-col items-start py-4" role="status">
        <CheckCircle2 className="size-14 text-brand-green-dark" aria-hidden="true" strokeWidth={2.25} />
        <h3 ref={successRef} tabIndex={-1} className="display mt-6 text-[2.75rem] outline-none md:text-5xl">
          {success.title}
        </h3>
        <p className="mt-4 max-w-md text-lead text-ink-body">
          {success.body(confirmation.name, confirmation.phone, confirmation.service)}
        </p>
        <p className="mt-6 font-semibold text-ink">
          {success.sooner}{" "}
          <a href={siteConfig.phone.href} className="whitespace-nowrap text-brand-green-dark underline decoration-2 underline-offset-4">
            {siteConfig.phone.display}
          </a>
        </p>
        <Button type="button" variant="cta-outline" size="cta-sm" className="mt-8" onClick={() => setConfirmation(null)}>
          {success.again}
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <Suspense fallback={null}>
        <ServiceFromQuery />
      </Suspense>

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="relative grid gap-5 sm:grid-cols-2" aria-describedby="booking-fallback">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{copy.name.label}</FormLabel>
              <FormControl>
                <Input autoComplete="name" enterKeyHint="next" placeholder={copy.name.placeholder} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{copy.phone.label}</FormLabel>
              <FormControl>
                <Input type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" placeholder={copy.phone.placeholder} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{copy.email.label}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  placeholder={copy.email.placeholder}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{copy.address.label}</FormLabel>
              <FormControl>
                <Input autoComplete="street-address" enterKeyHint="next" placeholder={copy.address.placeholder} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="service"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{copy.service.label}</FormLabel>
              <FormControl>
                <NativeSelect {...field}>
                  <option value="" disabled>
                    {copy.service.placeholder}
                  </option>
                  {services.map((service) => (
                    <option key={service.slug} value={service.slug}>
                      {service.title}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="preferredDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{copy.date.label}</FormLabel>
              <FormControl>
                <Input type="date" min={minDate} className="min-w-0 appearance-none text-left" {...field} />
              </FormControl>
              <FormDescription className="text-sm text-ink-muted">We&rsquo;ll confirm the exact time by phone.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>
                {copy.notes.label} <span className="font-normal text-ink-muted">({copy.notes.optional})</span>
              </FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder={copy.notes.placeholder} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Honeypot: hidden from people and assistive tech, tempting to bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
          <label>
            Company
            <input type="text" tabIndex={-1} autoComplete="off" {...form.register("company")} />
          </label>
        </div>

        {serverError && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-3 rounded-[1.25rem] border-2 border-destructive bg-white p-4 font-medium text-destructive outline-none sm:col-span-2"
          >
            <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>{serverError}</p>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-4 sm:col-span-2">
          <Button type="submit" variant="cta" size="cta" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {copy.submitting}
              </>
            ) : (
              <>
                {copy.submit}
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
          <p id="booking-fallback" className="text-center text-ink-body">
            {copy.fallback}{" "}
            <a
              href={siteConfig.phone.href}
              className="inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-brand-green decoration-2 underline-offset-4 hover:text-brand-green-dark"
            >
              <Phone className="size-4" aria-hidden="true" />
              {siteConfig.phone.display}
            </a>
          </p>
        </div>
      </form>
    </Form>
  );
}
