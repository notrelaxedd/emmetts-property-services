"use client"

/**
 * The latest nightly summary (headline, highlights, best streets, tomorrow's streets) and a
 * "Run now" button that rebuilds yesterday's summary on demand.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Sparkles } from "lucide-react"
import { runNightlySummaryAction } from "@/app/admin/actions/canvass"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/components/ui/toast"
import type { SummaryView } from "@/lib/canvass/views"

export function SummaryCard({ summary }: { summary: SummaryView | null }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()

  const run = () => {
    startTransition(async () => {
      const r = await runNightlySummaryAction()
      toast(r.ok ? { title: r.message ?? "Summary written", variant: "success" } : { title: "Couldn't run the summary", description: r.reason, variant: "destructive" })
      if (r.ok) router.refresh()
    })
  }

  const s = summary?.summary

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <Sparkles className="size-3.5" aria-hidden="true" /> Nightly summary{summary ? ` for ${summary.for_date}` : ""}
          </p>
          <h2 className="mt-1 text-lg font-semibold leading-tight text-ink">{s?.headline ?? "No summary yet"}</h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending}>
          <RefreshCw className={pending ? "animate-spin" : undefined} /> {pending ? "Running…" : "Run now"}
        </Button>
      </div>

      {!s ? (
        <p className="mt-2 text-sm text-ink-muted">
          Every morning at 6am the previous day&apos;s knocks are summarised here. Press Run now to build yesterday&apos;s summary straight away.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {s.highlights.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-body">
                {s.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Nothing to report for that day.</p>
            )}
            {s.best_streets.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Best streets</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {s.best_streets.map((b) => (
                    <li key={b.street}>
                      <span className="font-medium text-ink">{b.street}</span> <span className="text-ink-muted">{b.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {s.pitch_notes.length > 0 || s.knocker_notes.length > 0 ? (
              <ul className="space-y-0.5 text-sm text-ink-muted">
                {[...s.knocker_notes, ...s.pitch_notes].map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Tomorrow</p>
            {s.tomorrow.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">No street suggestions yet.</p>
            ) : (
              <ul className="mt-1 divide-y divide-ink/10 rounded-md border border-ink/10">
                {s.tomorrow.map((t, i) => (
                  <li key={`${t.street}-${i}`} className="px-3 py-2 text-sm">
                    <span className="font-medium text-ink">{t.street}</span>
                    <p className="text-xs text-ink-muted">{t.why}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
