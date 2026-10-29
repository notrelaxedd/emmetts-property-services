"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarDays, Phone } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type { Approval, PaymentMethod } from "@/lib/db/types"
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/ops/payment-methods"
import { formatDuration } from "@/lib/scheduler/time"
import { ApprovalShell, Facts } from "../approval-shell"
import { DecisionButtons } from "../decision-buttons"
import { label, money, slot } from "../format"
import { RejectDialog } from "../reject-dialog"
import type { BookingContext } from "../types"
import { useDecide } from "../use-action"

const ANSWER: Record<string, { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" }> = {
  offered: { label: "no answer yet", variant: "outline" },
  accepted: { label: "available", variant: "success" },
  declined: { label: "can't make it", variant: "destructive" },
  swap_offered: { label: "swap offered", variant: "warning" },
  drop_requested: { label: "wants to drop", variant: "warning" },
}

function fmtPhone(digits: string): string {
  const d = digits.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return digits
}

export function BookingCard({ approval, context }: { approval: Approval; context: BookingContext }) {
  const d = useDecide(approval.id)
  const { job, customer, crew, services, scheduleReason, quote, crewSize } = context
  const unschedulable = approval.payload.unschedulable === true
  const needsCover = approval.payload.needs_cover === true
  const callToConfirm = approval.payload.call_to_confirm === true
  // The scheduler's informational cards: nothing to book, nothing to undo.
  const info = unschedulable || needsCover
  const reason =
    (typeof approval.payload.reason === "string" && approval.payload.reason) || scheduleReason || approval.summary || null
  const scheduleHref = job ? `/admin/schedule?job=${job.id}` : "/admin/schedule"
  const phone = customer?.phone ?? (typeof approval.payload.phone === "string" ? approval.payload.phone : null)

  const [method, setMethod] = React.useState<PaymentMethod>(quote?.payment_method ?? "check")
  const [picked, setPicked] = React.useState<string[]>(() =>
    crew.filter((c) => c.status === "accepted").slice(0, Math.max(1, crewSize)).map((c) => c.id),
  )
  const ids = { method: React.useId() }
  const pickable = crew.filter((c) => c.status === "offered" || c.status === "accepted")
  const togglePick = (id: string, on: boolean) => setPicked((p) => (on ? Array.from(new Set([...p, id])) : p.filter((x) => x !== id)))

  const details = (
    <Facts
      items={[
        ["Customer", customer?.name ?? job?.customer_name ?? "—"],
        ["Address", customer?.address ?? job?.address ?? "—"],
        ["When", job ? slot(job.start_at, job.end_at) : "—"],
        ["Duration", job ? `${formatDuration(job.est_minutes)} · ${crewSize} crew` : "—"],
        ["Services", services.length ? services.join(", ") : "—"],
        ...(quote ? ([["Price", `${money(quote.price_total)}${quote.paid_at ? " (paid)" : ", collected after the job"}`]] as [React.ReactNode, React.ReactNode][]) : []),
        [
          "Crew",
          crew.length ? (
            <span key="crew" className="flex flex-wrap gap-1">
              {crew.map((c, i) => (
                <Badge key={i} variant={ANSWER[c.status]?.variant ?? "secondary"}>
                  {c.name} · {c.swapFrom ? `swap offered (from ${c.swapFrom})` : (ANSWER[c.status]?.label ?? label(c.status))}
                </Badge>
              ))}
            </span>
          ) : (
            "Nobody asked yet"
          ),
        ],
      ]}
    />
  )

  if (info) {
    return (
      <ApprovalShell
        approval={approval}
        error={context.error}
        className="border-amber-300"
        actions={
          <>
            <Button asChild size="sm">
              <Link href={scheduleHref}>
                <CalendarDays aria-hidden="true" /> Open schedule
              </Link>
            </Button>
            <div className="ml-auto">
              <RejectDialog
                disabled={d.pending}
                label="Mark handled"
                variant="outline"
                title="Mark this as handled?"
                description={
                  needsCover
                    ? "Use this once you've found someone or moved the job yourself. The scheduler will stop looking for cover until you release the job on the Schedule page. Nothing is sent."
                    : "Use this once you've placed the job by hand (or decided not to). The scheduler will leave it alone until you release it on the Schedule page. Nothing is sent."
                }
                onReject={(note) => d.decide("rejected", { note: note || "Handled on the schedule" })}
              />
            </div>
          </>
        }
      >
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950">
          <span className="font-semibold">
            {needsCover ? "Nobody else is free to cover this slot." : "The scheduler couldn’t place this job."}
          </span>{" "}
          {needsCover ? (approval.summary ?? reason ?? "No reason given.") : (reason ?? "No reason given.")}
        </p>
        {details}
      </ApprovalShell>
    )
  }

  if (callToConfirm) {
    const blocker = quote?.needs_owner
      ? "A line on the quote still needs your price."
      : job && job.status !== "proposed" && job.status !== "crew_confirmed"
        ? `The job is ${label(job.status).toLowerCase()}.`
        : null
    return (
      <ApprovalShell
        approval={approval}
        error={context.error}
        className="border-brand-green-dark/40"
        actions={
          <DecisionButtons
            d={d}
            kind={approval.kind}
            approveLabel={`Customer said yes: book it (${picked.length ? `${picked.length} crew` : "just me"}, ${PAYMENT_METHOD_LABEL[method].split(" ")[0].toLowerCase()})`}
            approveDisabled={!!blocker}
            onApprove={() => d.decide("edited", { payloadPatch: { payment_method: method, crew_ids: picked } }, { success: "Booked. Payment is collected after the job." })}
            edit={{ kind: "link", href: scheduleHref, label: "Open on schedule" }}
            rejectLabel="Take off the calendar"
          />
        }
      >
        <div className="grid gap-2 rounded-md bg-paper p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="text-sm">
            <p className="font-semibold text-ink">{phone ? fmtPhone(phone) : "No phone number on file"}</p>
            <p className="text-ink-muted">
              Confirm the price{quote ? ` (${money(quote.price_total)})` : ""} and the day, and ask how they&apos;ll pay. Tell them you collect cash, check or card once the job is done.
            </p>
          </div>
          {phone ? (
            <Button asChild size="sm">
              <a href={`tel:${phone.replace(/\D/g, "").length === 10 ? `+1${phone.replace(/\D/g, "")}` : phone}`}>
                <Phone aria-hidden="true" /> Call
              </a>
            </Button>
          ) : null}
        </div>
        {details}
        <div className="grid gap-3 rounded-md border border-ink/10 p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.method}>They&apos;ll pay by</Label>
            <NativeSelect id={ids.method} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={d.pending}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium leading-none text-ink">Who goes</legend>
            {pickable.length === 0 ? (
              <p className="text-xs text-ink-muted">Nobody to pick (no crew asked, or all said no). Book it with just you, or move the job.</p>
            ) : (
              pickable.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                  <Checkbox checked={picked.includes(c.id)} onCheckedChange={(v) => togglePick(c.id, v === true)} disabled={d.pending} />
                  {c.name}
                  <Badge variant={ANSWER[c.status]?.variant ?? "secondary"}>{ANSWER[c.status]?.label ?? c.status}</Badge>
                </label>
              ))
            )}
          </fieldset>
        </div>
        {blocker ? (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950">
            {blocker}{" "}
            {quote ? (
              <Link className="underline" href={`/admin/quotes/${quote.id}`}>
                Open the quote
              </Link>
            ) : null}
          </p>
        ) : null}
      </ApprovalShell>
    )
  }

  return (
    <ApprovalShell
      approval={approval}
      error={context.error}
      actions={
        <DecisionButtons
          d={d}
          kind={approval.kind}
          approveLabel="Book & confirm customer"
          edit={{ kind: "link", href: scheduleHref, label: "Change on schedule" }}
        />
      }
    >
      {details}
      {scheduleReason ? (
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">Why this slot:</span> {scheduleReason}
        </p>
      ) : null}
    </ApprovalShell>
  )
}
