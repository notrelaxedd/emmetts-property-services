"use client"

import { CrashCard } from "@/components/site/crash-card"

/** Last resort when the root layout itself fails: must render its own html / body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#F7F7F6", margin: 0, padding: "1rem" }}>
        <CrashCard error={error} reset={reset} homeHref="/" />
      </body>
    </html>
  )
}
