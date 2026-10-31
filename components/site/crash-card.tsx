"use client"

import * as React from "react"

type ErrorWithDigest = Error & { digest?: string }

/** Sends the crash to /api/client-error once so it appears in the server logs. Never throws. */
export function useReportCrash(error: ErrorWithDigest) {
  React.useEffect(() => {
    try {
      const body = JSON.stringify({
        message: error.message,
        digest: error.digest ?? null,
        stack: (error.stack ?? "").slice(0, 2000),
        url: window.location.href,
      })
      void fetch("/api/client-error", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(
        () => undefined,
      )
    } catch {
      // Reporting must never break the error page itself.
    }
  }, [error])
}

/** What a user sees when a page crashes in the browser: the message, a retry and a reload. */
export function CrashCard({ error, reset, homeHref }: { error: ErrorWithDigest; reset: () => void; homeHref: string }) {
  useReportCrash(error)
  return (
    <div className="mx-auto my-10 max-w-md rounded-lg border border-destructive/40 bg-white p-5 text-ink shadow-sm">
      <p className="text-base font-bold">This page hit an error</p>
      <p className="mt-2 break-words font-mono text-xs text-ink-muted">
        {error.message || "Unknown error"}
        {error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <p className="mt-2 text-sm text-ink-muted">It has been logged. Try again, or reload the page.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-10 items-center rounded-md border border-ink/25 px-4 text-sm font-semibold"
        >
          Reload
        </button>
        <a href={homeHref} className="inline-flex h-10 items-center px-2 text-sm font-semibold underline-offset-4 hover:underline">
          Home
        </a>
      </div>
    </div>
  )
}
