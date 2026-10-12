"use client";

import { useSearchParams } from "next/navigation";

const KEYS = ["source", "medium", "campaign", "content", "term"] as const;

/** Hidden inputs carrying utm_* query params into the form submit (stored on `leads.utm`). */
export function UtmFields() {
  const params = useSearchParams();
  return (
    <>
      {KEYS.map((k) => {
        const v = params.get(`utm_${k}`);
        return v ? <input key={k} type="hidden" name={`utm_${k}`} value={v.slice(0, 200)} /> : null;
      })}
    </>
  );
}
