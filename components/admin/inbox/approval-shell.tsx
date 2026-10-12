"use client"

import type * as React from "react"
import { AlertTriangle, Bot, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { Approval, ApprovalKind } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { timeAgo } from "./format"
import { KIND_LABELS } from "./types"

const KIND_STYLES: Record<ApprovalKind, string> = {
  ad: "bg-sky-100 text-sky-950",
  quote: "bg-brand-green/30 text-ink",
  custom_item: "bg-violet-100 text-violet-950",
  booking: "bg-blue-100 text-blue-950",
  weather_hold: "bg-cyan-100 text-cyan-950",
  followup: "bg-orange-100 text-orange-950",
  crew_change: "bg-pink-100 text-pink-950",
  drop: "bg-rose-100 text-rose-950",
  ai_cap: "bg-amber-200 text-amber-950",
}

export function KindBadge({ kind, className }: { kind: ApprovalKind; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", KIND_STYLES[kind], className)}>
      {KIND_LABELS[kind]}
    </Badge>
  )
}

/** True for worker names; users are recorded by email / "owner". */
function isWorker(createdBy: string) {
  return !createdBy.includes("@") && createdBy !== "owner"
}

/** Common card chrome: kind badge, title, summary, who + when, body and the decision footer. */
export function ApprovalShell({
  approval,
  error,
  children,
  actions,
  className,
}: {
  approval: Approval
  error?: string
  children?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  const worker = isWorker(approval.created_by)
  return (
    <Card
      className={cn(approval.kind === "ai_cap" && "border-amber-400 bg-amber-50", className)}
      aria-labelledby={`approval-${approval.id}`}
      role="article"
    >
      <CardHeader className="gap-1.5 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <KindBadge kind={approval.kind} />
          <span className="inline-flex items-center gap-1">
            {worker ? <Bot className="size-3.5" aria-hidden="true" /> : <User className="size-3.5" aria-hidden="true" />}
            {approval.created_by}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={approval.created_at} suppressHydrationWarning title={new Date(approval.created_at).toISOString()}>
            {timeAgo(approval.created_at)}
          </time>
        </div>
        <CardTitle id={`approval-${approval.id}`} className="text-base sm:text-lg">
          {approval.title}
        </CardTitle>
        {approval.summary ? <p className="text-sm text-ink-muted">{approval.summary}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {children}
      </CardContent>
      {actions ? <CardFooter className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">{actions}</CardFooter> : null}
    </Card>
  )
}

/** Label / value pairs. */
export function Facts({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
