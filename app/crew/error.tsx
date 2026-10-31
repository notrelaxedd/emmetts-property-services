"use client"

import { CrashCard } from "@/components/site/crash-card"

export default function CrewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashCard error={error} reset={reset} homeHref="/crew" />
}
