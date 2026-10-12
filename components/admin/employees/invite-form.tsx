"use client"

import * as React from "react"
import { UserPlus } from "lucide-react"
import { inviteCrew } from "@/app/admin/actions/employees"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"

export function InviteForm({ defaultRate }: { defaultRate: number }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState("")
  const [contact, setContact] = React.useState("")
  const [rate, setRate] = React.useState(String(defaultRate))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await inviteCrew({ name, contact, rate: rate.trim() === "" ? null : Number(rate) })
      if (r.ok) {
        toast({ title: "Crew member invited", description: r.message, variant: "success" })
        setName("")
        setContact("")
      } else toast({ title: "Couldn't send the invite", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.3fr_8rem_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="inv-name">Name</Label>
        <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-contact">Email or mobile number</Label>
        <Input
          id="inv-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
          placeholder="kevin@example.com or (440) 555-0100"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-rate">Rate ($/hr)</Label>
        <Input id="inv-rate" type="number" inputMode="decimal" min={0} step={0.25} value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        <UserPlus /> {pending ? "Inviting…" : "Invite crew"}
      </Button>
      <p className="text-xs text-ink-muted sm:col-span-2 lg:col-span-4">
        Email gets a magic link to the crew app. A phone number signs in with a text code at the login page.
      </p>
    </form>
  )
}
