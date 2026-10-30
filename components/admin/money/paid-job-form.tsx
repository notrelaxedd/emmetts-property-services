"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { recordPaidJob, removePaidJob } from "@/app/admin/actions/money"
import { INTERACTION_CATEGORIES } from "@/components/admin/customers/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { PaymentMethod } from "@/lib/db/types"

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "stripe", label: "Card" },
]

export type PaidJobCustomer = { id: string; name: string; address: string | null }

/**
 * "Add a paid job": a job that's already done and paid goes straight onto the Money page. On the Money
 * page you pick the customer; on a customer's page (`customer` set) it's already picked.
 * "They paid" follows the price until it's changed, so the usual case is price → Save.
 */
export function PaidJobForm({
  today,
  defaultDate = today,
  customers = [],
  customer,
}: {
  today: string
  defaultDate?: string
  customers?: PaidJobCustomer[]
  customer?: { id: string; name: string }
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [customerId, setCustomerId] = React.useState(customer?.id ?? "")
  const [date, setDate] = React.useState(defaultDate)
  const [description, setDescription] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [paid, setPaid] = React.useState("")
  const [paidTouched, setPaidTouched] = React.useState(false)
  const [method, setMethod] = React.useState<PaymentMethod>("cash")
  const [labor, setLabor] = React.useState("")
  const id = (k: string) => `pj-${customer ? "c-" : ""}${k}`

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await recordPaidJob({
        customerId,
        description,
        date,
        price: Number(price),
        paid: Number(paidTouched ? paid : price),
        method,
        labor: labor.trim() === "" ? 0 : Number(labor),
      })
      if (r.ok) {
        const who = customer?.name ?? customers.find((c) => c.id === customerId)?.name
        toast({ title: r.message ?? "Saved", description: who ? `${who}: ${description.trim()}` : undefined, variant: "success" })
        setDescription("")
        setPrice("")
        setPaid("")
        setPaidTouched(false)
        setLabor("")
        if (!customer) setCustomerId("")
      } else toast({ title: "Couldn't save the job", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {customer ? null : (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={id("customer")}>Customer</Label>
            <NativeSelect id={id("customer")} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="" disabled>
                {customers.length ? "Pick a customer…" : "No customers yet"}
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.address ? `${c.name} · ${c.address}` : c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className={customer ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
          <Label htmlFor={id("what")}>What we did</Label>
          <Input
            id={id("what")}
            list={id("what-list")}
            value={description}
            maxLength={250}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Fall cleanup"
            required
          />
          <datalist id={id("what-list")}>
            {INTERACTION_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("date")}>Date</Label>
          <Input id={id("date")} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={id("price")}>Price ($)</Label>
          <Input
            id={id("price")}
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("paid")}>They paid ($)</Label>
          <Input
            id={id("paid")}
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            value={paidTouched ? paid : price}
            onChange={(e) => {
              setPaidTouched(true)
              setPaid(e.target.value)
            }}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("method")}>Paid by</Label>
          <NativeSelect id={id("method")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("labor")}>Crew pay ($)</Label>
          <Input
            id={id("labor")}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={labor}
            onChange={(e) => setLabor(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <Button type="submit" className="col-span-2 lg:col-span-1" disabled={pending || !customerId || !price || !description.trim()}>
          {pending ? "Saving…" : "Paid & done"}
        </Button>
      </div>
      {method === "stripe" ? <p className="text-xs text-ink-muted">The card fee from your settings comes off the profit.</p> : null}
    </form>
  )
}

/** Undo for a job added by hand (on the customer's page). */
export function RemovePaidJobButton({ quoteId, label }: { quoteId: string; label: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const remove = () => {
    if (!window.confirm(`Remove ${label}? It comes off the Money page too.`)) return
    startTransition(async () => {
      const r = await removePaidJob(quoteId)
      toast(r.ok ? { title: r.message ?? "Removed", variant: "success" } : { title: "Couldn't remove it", description: r.reason, variant: "destructive" })
    })
  }
  return (
    <Button variant="ghost" size="icon" className="size-8" disabled={pending} onClick={remove}>
      <Trash2 />
      <span className="sr-only">Remove this job</span>
    </Button>
  )
}
