"use client"

import { Ban, RefreshCw, RotateCcw, ThumbsDown } from "lucide-react"
import { rerunQuote, setLeadStatus } from "@/app/admin/actions/leads"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import type { LeadStatus } from "@/lib/db/types"

export function LeadActions({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const { pending, run } = useActionRunner()
  const closed = status === "spam" || status === "lost"
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => rerunQuote(leadId))}>
        <RefreshCw aria-hidden="true" /> Re-run quote
      </Button>
      {closed ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => setLeadStatus(leadId, "new"))}>
          <RotateCcw aria-hidden="true" /> Restore
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => setLeadStatus(leadId, "lost"))}>
            <ThumbsDown aria-hidden="true" /> Mark lost
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => setLeadStatus(leadId, "spam"))}>
            <Ban aria-hidden="true" /> Mark spam
          </Button>
        </>
      )}
    </div>
  )
}
