import { Badge } from "@/components/ui/badge"
import type { LeadStatus, QuoteStatus } from "@/lib/db/types"
import { label } from "@/components/admin/inbox/format"

type Variant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive"

const LEAD: Record<LeadStatus, Variant> = {
  new: "warning",
  quoting: "secondary",
  quoted: "secondary",
  won: "success",
  lost: "outline",
  spam: "outline",
}

const QUOTE: Record<QuoteStatus, Variant> = {
  draft: "secondary",
  needs_owner: "warning",
  sent: "default",
  accepted: "success",
  expired: "outline",
  declined: "outline",
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge variant={LEAD[status]}>{label(status)}</Badge>
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge variant={QUOTE[status]}>{status === "needs_owner" ? "Needs you" : label(status)}</Badge>
}
