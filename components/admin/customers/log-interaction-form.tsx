"use client"

import * as React from "react"
import Link from "next/link"
import { logInteraction, priceHistoryForPhone, type PriceHistory } from "@/app/admin/actions/customers"
import { usd } from "@/app/admin/money/math"
import { INTERACTION_CATEGORIES, interactionStatusLabel } from "@/components/admin/customers/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { normalizePhone } from "@/lib/ops/phone"

/**
 * Log a conversation with a customer: who, what it was about, the price given, when to follow up.
 * With `customer` set (the customer log page) the name and phone are already known; otherwise the
 * phone number finds the existing customer, and anything already quoted to them shows up while typing.
 */
export function LogInteractionForm({
  today,
  customer,
  categories = [],
}: {
  today: string
  customer?: { id: string; name: string }
  /** Categories used before, offered alongside the defaults. */
  categories?: string[]
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [price, setPrice] = React.useState("")
  const [talkedOn, setTalkedOn] = React.useState(today)
  const [followUpOn, setFollowUpOn] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [history, setHistory] = React.useState<PriceHistory | null>(null)

  // The address on file for the number typed, so it can be swapped out again if the number changes.
  const filledAddress = React.useRef<string | null>(null)
  const fillAddress = (next: string | null) => {
    setAddress((a) => (a === "" || a === filledAddress.current ? (next ?? "") : a))
    filledAddress.current = next
  }

  const digits = normalizePhone(phone)
  React.useEffect(() => {
    if (customer || digits.length !== 10) {
      setHistory(null)
      fillAddress(null)
      return
    }
    let live = true
    priceHistoryForPhone(digits)
      .then((h) => {
        if (!live) return
        setHistory(h)
        if (h.customer) setName((n) => n || h.customer!.name)
        fillAddress(h.customer?.address ?? null)
      })
      .catch(() => {
        if (live) setHistory(null)
      })
    return () => {
      live = false
    }
  }, [customer, digits])

  const suggestions = Array.from(new Set([...INTERACTION_CATEGORIES, ...categories]))
  const id = (k: string) => `pl-${customer ? "c-" : ""}${k}`

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = price.trim() === "" ? null : Number(price)
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast({ title: "Price must be a dollar amount", variant: "destructive" })
      return
    }
    startTransition(async () => {
      const r = await logInteraction({
        customerId: customer?.id ?? null,
        name,
        phone,
        address: address.trim(),
        category,
        price: amount,
        notes: notes.trim() || null,
        talkedOn,
        followUpOn: followUpOn || null,
      })
      if (r.ok) {
        toast({ title: r.message ?? "Saved", variant: "success" })
        setName("")
        setPhone("")
        setAddress("")
        filledAddress.current = null
        setCategory("")
        setPrice("")
        setFollowUpOn("")
        setNotes("")
        setTalkedOn(today)
      } else toast({ title: "Couldn't save", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {customer ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={id("phone")}>Phone</Label>
            <Input
              id={id("phone")}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              maxLength={40}
              placeholder="(440) 555-0100"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("name")}>Name</Label>
            <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="off" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={id("address")}>Address (optional)</Label>
            <Input
              id={id("address")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
              placeholder="123 Main St, Rocky River, OH 44116"
              readOnly={Boolean(history?.customer?.address)}
              autoComplete="off"
            />
            {history?.customer?.address ? (
              <p className="text-xs text-ink-muted">On file. Change it on their customer page.</p>
            ) : null}
          </div>
        </div>
      )}

      {history?.customer ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
          <p>
            Already a customer:{" "}
            <Link href={`/admin/customers/${history.customer.id}`} className="font-medium underline underline-offset-4">
              {history.customer.name}
            </Link>
            {history.entries.length ? ". What they were told before:" : ". Nothing in the price log yet."}
          </p>
          {history.entries.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {history.entries.map((e) => (
                <li key={e.id} className="tabular-nums">
                  {e.talked_on} · {e.category} · <span className="font-semibold">{e.price === null ? "no price" : usd(e.price)}</span> ·{" "}
                  {interactionStatusLabel(e.status)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor={id("category")}>What about</Label>
          <Input
            id={id("category")}
            list={id("categories")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            maxLength={80}
            placeholder="Leaves, snow plowing…"
            autoComplete="off"
          />
          <datalist id={id("categories")}>
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("price")}>Price given ($)</Label>
          <Input id={id("price")} type="number" inputMode="decimal" min={0} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("talked")}>Talked on</Label>
          <Input id={id("talked")} type="date" value={talkedOn} max={today} onChange={(e) => setTalkedOn(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("follow")}>Follow up by (optional)</Label>
          <Input id={id("follow")} type="date" value={followUpOn} min={talkedOn} onChange={(e) => setFollowUpOn(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("notes")}>Notes (optional)</Label>
        <Textarea
          id={id("notes")}
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Per visit or for the season, front yard only, wants it after Thanksgiving…"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save to price log"}
      </Button>
    </form>
  )
}
