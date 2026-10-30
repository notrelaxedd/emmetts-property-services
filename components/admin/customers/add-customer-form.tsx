"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { addCustomer, type NewCustomer } from "@/app/admin/actions/customers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"

const EMPTY: NewCustomer = { name: "", phone: "", email: "", address: "", parcel_id: "", notes: "" }

/** "Add a customer": only the name is required. Opens their page once saved (add a paid job there). */
export function AddCustomerForm() {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [v, setV] = React.useState<NewCustomer>(EMPTY)
  const [existing, setExisting] = React.useState<{ id: string; reason: string } | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setExisting(null)
    startTransition(async () => {
      const r = await addCustomer(v)
      if (r.ok) {
        toast({ title: r.message, variant: "success" })
        router.push(`/admin/customers/${r.id}`)
      } else if (r.existingId) {
        setExisting({ id: r.existingId, reason: r.reason })
      } else {
        toast({ title: "Couldn't add them", description: r.reason, variant: "destructive" })
      }
    })
  }

  const field = (key: keyof NewCustomer, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`nc-${key}`}>{label}</Label>
      <Input id={`nc-${key}`} value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} {...props} />
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Name", { required: true, maxLength: 120, autoComplete: "off", autoFocus: true })}
        {field("phone", "Phone (optional)", { type: "tel", inputMode: "tel", maxLength: 40, placeholder: "(440) 555-0100" })}
        {field("email", "Email (optional)", { type: "email", maxLength: 254, placeholder: "name@example.com" })}
        {field("address", "Address (optional)", { maxLength: 300, placeholder: "123 Main St, City, OH 44000" })}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nc-notes">Notes (optional)</Label>
        <Textarea
          id="nc-notes"
          rows={3}
          maxLength={5000}
          value={v.notes}
          onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))}
          placeholder="e.g. Did their leaves last fall; wants snow plowing this winter"
        />
      </div>
      {existing ? (
        <p className="text-sm text-ink" role="alert">
          {existing.reason}{" "}
          <Link href={`/admin/customers/${existing.id}`} className="font-medium underline underline-offset-4">
            Open them
          </Link>
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !v.name.trim()}>
        {pending ? "Adding…" : "Add customer"}
      </Button>
    </form>
  )
}
