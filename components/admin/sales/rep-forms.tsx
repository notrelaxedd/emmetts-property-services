"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UserPlus } from "lucide-react"
import { createSalesRep, removeSalesRep, restoreSalesRep, updateSalesRep } from "@/app/admin/actions/sales-reps"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"

/** Add a rep: they show up in the /door dropdown right away. */
export function AddSalesRepForm() {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [rate, setRate] = React.useState("20")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await createSalesRep({ name, phone: phone.trim() || null, ratePercent: rate.trim() === "" ? null : Number(rate) })
      if (r.ok) {
        toast({ title: "Sales rep added", description: r.message, variant: "success" })
        setName("")
        setPhone("")
        setRate("20")
      } else toast({ title: "Couldn't add them", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_8rem_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="sr-name">Name</Label>
        <Input id="sr-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="off" placeholder="Addy" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sr-phone">Phone (optional)</Label>
        <Input id="sr-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="(440) 555-0100" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sr-rate">Commission (%)</Label>
        <Input id="sr-rate" type="number" inputMode="decimal" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending || !name.trim()}>
        <UserPlus /> {pending ? "Adding…" : "Add sales rep"}
      </Button>
    </form>
  )
}

/** Name, phone and commission rate, plus remove / restore. */
export function SalesRepSettings({
  rep,
}: {
  rep: { id: string; name: string; phone: string | null; ratePercent: number; removed: boolean }
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState(rep.name)
  const [phone, setPhone] = React.useState(rep.phone ?? "")
  const [rate, setRate] = React.useState(String(rep.ratePercent))
  const dirty = name !== rep.name || phone !== (rep.phone ?? "") || Number(rate) !== rep.ratePercent

  React.useEffect(() => {
    setName(rep.name)
    setPhone(rep.phone ?? "")
    setRate(String(rep.ratePercent))
  }, [rep.name, rep.phone, rep.ratePercent])

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await updateSalesRep(rep.id, { name, phone: phone.trim() || null, ratePercent: Number(rate) })
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
        <div className="space-y-1.5">
          <Label htmlFor="rs-name">Name</Label>
          <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-phone">Phone</Label>
          <Input id="rs-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-rate">Commission (%)</Label>
          <Input id="rs-rate" type="number" inputMode="decimal" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-ink-muted">A new rate applies to jobs not paid yet. Jobs already paid keep what you paid.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || pending || rate.trim() === ""}>
          Save
        </Button>
        {rep.removed ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await restoreSalesRep(rep.id)
                toast(r.ok ? { title: r.message ?? "Restored", variant: "success" } : { title: "Couldn't restore", description: r.reason, variant: "destructive" })
              })
            }
          >
            Restore
          </Button>
        ) : (
          <ConfirmDialog
            trigger="Remove"
            triggerVariant="ghost"
            title={`Remove ${rep.name}?`}
            description="They come off the /door dropdown. Their jobs and what you've paid them stay on record."
            confirmLabel="Remove"
            onConfirm={async () => {
              const r = await removeSalesRep(rep.id)
              toast(r.ok ? { title: r.message ?? "Removed", variant: "success" } : { title: "Couldn't remove", description: r.reason, variant: "destructive" })
              if (r.ok) router.push("/admin/employees/sales")
              return r.ok
            }}
          />
        )}
      </div>
    </form>
  )
}
