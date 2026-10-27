"use client"

import * as React from "react"
import { updateCustomer, type CustomerContact } from "@/app/admin/actions/customers"
import { formatPhone } from "@/components/admin/customers/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"

type Fields = Record<keyof CustomerContact, string>

/**
 * The Contact card on the customer page: name, email, phone, address and parcel number, all
 * editable after the customer exists (the quote form or the price log created them).
 */
export function CustomerContactForm({ id, initial, since }: { id: string; initial: CustomerContact; since: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const { name, email, phone, address, parcel_id } = initial
  const stored = React.useMemo<Fields>(
    () => ({ name, email: email ?? "", phone: phone ? formatPhone(phone) : "", address: address ?? "", parcel_id: parcel_id ?? "" }),
    [name, email, phone, address, parcel_id],
  )
  const [v, setV] = React.useState(stored)
  // After a save the page comes back with what was stored (phone formatted, email lower-cased): show that.
  React.useEffect(() => setV(stored), [stored])
  const dirty = (Object.keys(stored) as (keyof Fields)[]).some((k) => v[k] !== stored[k])
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await updateCustomer(id, {
        name: v.name,
        email: v.email || null,
        phone: v.phone || null,
        address: v.address || null,
        parcel_id: v.parcel_id || null,
      })
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cc-name">Name</Label>
        <Input id="cc-name" value={v.name} onChange={set("name")} required maxLength={120} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-email">Email</Label>
        <Input id="cc-email" type="email" inputMode="email" value={v.email} onChange={set("email")} maxLength={254} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-phone">Phone</Label>
        <Input id="cc-phone" type="tel" inputMode="tel" value={v.phone} onChange={set("phone")} maxLength={40} placeholder="(440) 555-0100" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-address">Address</Label>
        <Input id="cc-address" value={v.address} onChange={set("address")} maxLength={200} placeholder="123 Main St, Rocky River, OH 44116" autoComplete="off" />
        <p className="text-xs text-ink-muted">Street, city, state and ZIP on one line. A new address moves the map pin.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cc-parcel">Parcel number</Label>
        <Input id="cc-parcel" value={v.parcel_id} onChange={set("parcel_id")} maxLength={80} autoComplete="off" />
      </div>
      <p className="text-xs text-ink-muted">Customer since {since}</p>
      <Button type="submit" disabled={!dirty || pending}>
        {pending ? "Saving…" : "Save contact"}
      </Button>
    </form>
  )
}
