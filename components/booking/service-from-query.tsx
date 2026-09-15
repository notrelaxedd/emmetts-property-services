"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFormContext } from "react-hook-form";
import type { BookingInput } from "@/lib/booking-schema";
import { isServiceSlug } from "@/lib/services";

/**
 * Syncs ?service=<slug> into the form's service dropdown. Lives in its own Suspense boundary so the
 * rest of the page stays statically rendered. Also reacts when a service card link changes the query.
 */
export function ServiceFromQuery() {
  const params = useSearchParams();
  const { setValue } = useFormContext<BookingInput>();
  const service = params.get("service");

  useEffect(() => {
    if (isServiceSlug(service)) {
      setValue("service", service, { shouldDirty: true, shouldValidate: false });
    }
  }, [service, setValue]);

  return null;
}
