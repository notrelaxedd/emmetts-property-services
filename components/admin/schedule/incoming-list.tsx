"use client"

import Link from "next/link"
import { Loader2, RotateCw, X } from "lucide-react"
import { rerunQuote, setLeadStatus } from "@/app/admin/actions/leads"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import type { Incoming } from "./types"

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`
}

/**
 * The top of the Jobs rail: requests the worker is still estimating, then estimates waiting on your
 * price. Once a request has a price it becomes a job tile below and can be dragged onto the week.
 */
export function IncomingList({ incoming }: { incoming: Incoming }) {
  const { pending, run } = useActionRunner()
  const { estimating, needsPrice } = incoming
  if (!estimating.length && !needsPrice.length) return null

  return (
    <div className="space-y-3 border-b border-ink/10 pb-3">
      {estimating.length ? (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Being estimated</h3>
          {estimating.map((l) => (
            <div key={l.leadId} className="rounded-md border border-dashed border-ink/20 bg-white px-2 py-2 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-green-dark" aria-hidden="true" />
                <Link href={`/admin/leads/${l.leadId}`} className="truncate hover:underline">
                  {l.customerName}
                </Link>
                <span className="ml-auto shrink-0 text-xs font-normal text-ink-muted">{ago(l.createdAt)}</span>
              </p>
              <p className="truncate text-xs text-ink-muted">{l.services.join(", ") || "Services"}</p>
              <div className="mt-1 flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={pending}
                  onClick={() => void run(() => rerunQuote(l.leadId), { success: "Estimating again" })}
                >
                  <RotateCw aria-hidden="true" /> Retry
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-ink-muted"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Dismiss ${l.customerName}'s request? It won't get estimated.`)) void run(() => setLeadStatus(l.leadId, "lost"), { success: "Dismissed" })
                  }}
                >
                  <X aria-hidden="true" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {needsPrice.length ? (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Needs your price</h3>
          {needsPrice.map((q) => (
            <Link
              key={q.quoteId}
              href={`/admin/quotes/${q.quoteId}`}
              className="block rounded-md border border-amber-400 bg-amber-50 px-2 py-2 text-sm hover:bg-amber-100"
            >
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="truncate">{q.customerName}</span>
                <span className="ml-auto shrink-0 text-xs font-semibold text-amber-900">Set price →</span>
              </span>
              <span className="block truncate text-xs text-ink-muted">{q.services.join(", ") || "Custom request"}</span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  )
}
