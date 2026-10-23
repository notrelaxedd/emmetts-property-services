"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { removeFlyerWorker, restoreFlyerWorker, updateFlyerWorker } from "@/app/admin/actions/flyers"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"

/** Name, phone and default pay per flyer, plus remove / restore. */
export function WorkerSettings({
  worker,
}: {
  worker: { id: string; name: string; phone: string | null; rate: number; removed: boolean }
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [name, setName] = React.useState(worker.name)
  const [phone, setPhone] = React.useState(worker.phone ?? "")
  const [rate, setRate] = React.useState(String(worker.rate))
  const dirty = name !== worker.name || phone !== (worker.phone ?? "") || Number(rate) !== worker.rate

  React.useEffect(() => {
    setName(worker.name)
    setPhone(worker.phone ?? "")
    setRate(String(worker.rate))
  }, [worker.name, worker.phone, worker.rate])

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await updateFlyerWorker(worker.id, { name, phone: phone.trim() || null, rate: Number(rate) })
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-phone">Phone</Label>
          <Input id="ws-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-rate">Pay per flyer ($)</Label>
          <Input id="ws-rate" type="number" inputMode="decimal" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-ink-muted">The pay rate fills in new batches. Batches already logged keep their own rate.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || pending || rate.trim() === ""}>
          Save
        </Button>
        {worker.removed ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await restoreFlyerWorker(worker.id)
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
            title={`Remove ${worker.name}?`}
            description="They come off the flyer worker list. Batches, pay and the quote requests from their flyers stay on record, and flyers already handed out still work."
            confirmLabel="Remove"
            onConfirm={async () => {
              const r = await removeFlyerWorker(worker.id)
              toast(r.ok ? { title: r.message ?? "Removed", variant: "success" } : { title: "Couldn't remove", description: r.reason, variant: "destructive" })
              if (r.ok) router.push("/admin/employees/flyers")
              return r.ok
            }}
          />
        )}
      </div>
    </form>
  )
}
