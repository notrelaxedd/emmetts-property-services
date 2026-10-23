"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UserPlus } from "lucide-react"
import { createFlyerWorker } from "@/app/admin/actions/flyers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { DEFAULT_RATE_PER_FLYER } from "@/lib/flyers/codes"

export function AddFlyerWorkerForm() {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [rate, setRate] = React.useState(String(DEFAULT_RATE_PER_FLYER))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await createFlyerWorker({ name, phone: phone.trim() || null, rate: rate.trim() === "" ? null : Number(rate) })
      if (r.ok) {
        toast({ title: "Flyer worker added", description: r.message, variant: "success" })
        if (r.id) router.push(`/admin/employees/flyers/${r.id}`)
      } else toast({ title: "Couldn't add them", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9rem_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="fw-name">Name</Label>
        <Input id="fw-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fw-phone">Phone (optional)</Label>
        <Input id="fw-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="(440) 555-0100" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fw-rate">Pay per flyer ($)</Label>
        <Input id="fw-rate" type="number" inputMode="decimal" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        <UserPlus /> {pending ? "Adding…" : "Add flyer worker"}
      </Button>
      <p className="text-xs text-ink-muted sm:col-span-2 lg:col-span-4">
        Flyer workers don’t sign in. Each one gets a code and their own QR code on the flyer, so every quote request from
        their flyers is credited to them.
      </p>
    </form>
  )
}
